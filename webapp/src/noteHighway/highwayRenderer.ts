import {
  BLACK_KEY_LANE_HALF_WIDTH,
  GRID_LINE_INSTANCE_FLOATS,
  HIGHWAY_HALF_WIDTH,
  highwayCamera,
  keyApproachProgress,
  lowerBound,
  NOTE_INSTANCE_FLOATS,
  upperBound,
  visibleNoteRange,
  type HighwayCamera,
  type HighwayTrack,
} from "./highwayModel";

const KEY_COUNT = 88;
/** Shortest drawn block and the gap that separates repeated notes, in world units. */
const MIN_NOTE_LENGTH = 0.35;
const REPEAT_GAP = 0.12;

const WHITE_NOTE_COLOR = new Float32Array([0.25, 0.84, 0.72]);
const BLACK_NOTE_COLOR = new Float32Array([0.56, 0.42, 1.0]);

const NOTE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_corner;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_axes;
layout(location = 3) in vec4 a_lane;
layout(location = 4) in vec2 a_time;

uniform mat4 u_viewProjection;
uniform float u_now;
uniform float u_unitsPerTime;
uniform float u_length;
uniform float u_minLength;
uniform float u_gap;

out vec3 v_normal;
out vec2 v_uv;
out vec2 v_faceSize;
out float v_far;
out float v_black;
out float v_sounding;

void main() {
  float headZ = -(a_time.x - u_now) * u_unitsPerTime;
  float tailZ = min(-(a_time.y - u_now) * u_unitsPerTime + u_gap, headZ - u_minLength);
  // The part of a note already past the hit line has gone into the keyboard.
  float nearZ = min(headZ, 0.0);
  float farZ = max(tailZ, -u_length);
  if (farZ >= nearZ - 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 size = vec3(2.0 * a_lane.y, a_lane.z, nearZ - farZ);
  vec3 world = vec3(a_lane.x - a_lane.y, 0.0, farZ) + a_corner * size;
  gl_Position = u_viewProjection * vec4(world, 1.0);
  v_normal = a_normal;
  v_uv = vec2(a_corner[int(a_axes.x)], a_corner[int(a_axes.y)]);
  v_faceSize = vec2(size[int(a_axes.x)], size[int(a_axes.y)]);
  v_far = clamp(-world.z / u_length, 0.0, 1.0);
  v_black = a_lane.w;
  v_sounding = headZ >= 0.0 ? 1.0 : 0.0;
}`;

const NOTE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in vec2 v_faceSize;
in float v_far;
in float v_black;
in float v_sounding;

uniform vec3 u_whiteColor;
uniform vec3 u_blackColor;

out vec4 outColor;

void main() {
  vec3 base = mix(u_whiteColor, u_blackColor, v_black);
  vec3 light = normalize(vec3(-0.35, 0.85, 0.45));
  float diffuse = max(dot(normalize(v_normal), light), 0.0);
  vec3 color = base * (0.38 + 0.72 * diffuse);
  vec2 edgeDistance = min(v_uv, 1.0 - v_uv) * v_faceSize;
  float edge = 1.0 - smoothstep(0.025, 0.075, min(edgeDistance.x, edgeDistance.y));
  color = mix(color, vec3(1.0), edge * 0.5);
  color = mix(color, min(base * 1.6 + 0.25, vec3(1.0)), v_sounding * 0.55);
  float alpha = 1.0 - smoothstep(0.6, 1.0, v_far);
  outColor = vec4(color * alpha, alpha);
}`;

const FLOOR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;

uniform mat4 u_viewProjection;
uniform float u_halfWidth;
uniform float u_length;

out vec2 v_world;

void main() {
  v_world = vec2(-u_halfWidth + a_corner.x * 2.0 * u_halfWidth, -a_corner.y * u_length);
  gl_Position = u_viewProjection * vec4(v_world.x, 0.0, v_world.y, 1.0);
}`;

const FLOOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_world;

uniform float u_halfWidth;
uniform float u_length;
uniform float u_blackHalfWidth;
uniform vec4 u_glow[22];
uniform vec3 u_whiteColor;
uniform vec3 u_blackColor;

out vec4 outColor;

// Semitones above A for the white keys A B C D E F G.
const int WHITE_OFFSETS[7] = int[7](0, 2, 3, 5, 7, 8, 10);

bool hasSharp(int letter) {
  return letter == 0 || letter == 2 || letter == 3 || letter == 5 || letter == 6;
}

void main() {
  float keyX = v_world.x + u_halfWidth;
  float far = clamp(-v_world.y / u_length, 0.0, 1.0);
  float pixel = fwidth(keyX);

  int whiteIndex = int(clamp(floor(keyX), 0.0, 51.0));
  int midi = 21 + 12 * (whiteIndex / 7) + WHITE_OFFSETS[whiteIndex % 7];
  bool blackLane = false;
  float boundary = floor(keyX + 0.5);
  int boundaryIndex = int(boundary);
  if (boundaryIndex >= 1 && boundaryIndex <= 51 && abs(keyX - boundary) < u_blackHalfWidth) {
    int previous = boundaryIndex - 1;
    if (hasSharp(previous % 7)) {
      blackLane = true;
      midi = 21 + 12 * (previous / 7) + WHITE_OFFSETS[previous % 7] + 1;
    }
  }

  // Alternate octaves (C to B) so the hand can find its place, as on the keys.
  bool oddOctave = ((whiteIndex + 5) / 7) % 2 == 1;
  vec3 color = blackLane ? vec3(0.03, 0.035, 0.045) : vec3(0.1, 0.11, 0.13);
  if (oddOctave) color *= 1.25;

  float whiteEdge = min(fract(keyX), 1.0 - fract(keyX));
  float divider = blackLane ? 0.0 : 1.0 - smoothstep(0.012, 0.012 + pixel * 1.5, whiteEdge);
  bool octaveLine = whiteIndex % 7 == 2 && fract(keyX) < 0.5;
  color = mix(color, vec3(0.32, 0.35, 0.38), divider * (octaveLine ? 0.95 : 0.45));

  int key = midi - 21;
  float glow = u_glow[key >> 2][key & 3];
  vec3 glowColor = blackLane ? u_blackColor : u_whiteColor;
  color += glowColor * glow * (0.18 + 0.5 * (1.0 - smoothstep(0.0, 0.45, far)));

  float hit = 1.0 - smoothstep(0.06, 0.06 + fwidth(v_world.y) * 1.5 + 0.12, -v_world.y);
  float rail = 1.0 - smoothstep(0.08, 0.08 + pixel * 1.5, u_halfWidth - abs(v_world.x));
  vec3 accent = vec3(1.0, 0.76, 0.36);
  color = mix(color, accent, max(hit, rail * 0.85));

  float fade = 1.0 - smoothstep(0.08, 1.0, far);
  float alpha = max(0.84 * fade, max(hit, rail) * (1.0 - smoothstep(0.55, 1.0, far)));
  outColor = vec4(min(color, vec3(1.0)) * alpha, alpha);
}`;

const LINE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_line;

uniform mat4 u_viewProjection;
uniform float u_now;
uniform float u_unitsPerTime;
uniform float u_halfWidth;
uniform float u_length;

out float v_far;
out float v_strength;
out float v_across;

void main() {
  float z = -(a_line.x - u_now) * u_unitsPerTime;
  if (z > 0.0 || z < -u_length) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float thickness = mix(0.05, 0.12, a_line.y);
  vec3 world = vec3(
    -u_halfWidth + a_corner.x * 2.0 * u_halfWidth,
    0.0,
    z + (a_corner.y - 0.5) * thickness
  );
  gl_Position = u_viewProjection * vec4(world, 1.0);
  v_far = clamp(-z / u_length, 0.0, 1.0);
  v_strength = a_line.y;
  v_across = a_corner.y;
}`;

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_far;
in float v_strength;
in float v_across;

out vec4 outColor;

void main() {
  float profile = 1.0 - abs(v_across * 2.0 - 1.0);
  float alpha = v_strength * 0.5 * profile * (1.0 - smoothstep(0.35, 1.0, v_far));
  outColor = vec4(vec3(0.82, 0.88, 0.92) * alpha, alpha);
}`;

/** Top, front, left and right faces; the bottom and back are never seen. */
function noteBoxGeometry(): {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint16Array<ArrayBuffer>;
} {
  // corner xyz, normal xyz, uv axes
  const faces: { corners: number[][]; normal: number[]; axes: number[] }[] = [
    { corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], normal: [0, 1, 0], axes: [0, 2] },
    { corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], normal: [0, 0, 1], axes: [0, 1] },
    { corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], normal: [-1, 0, 0], axes: [2, 1] },
    { corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], normal: [1, 0, 0], axes: [2, 1] },
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  faces.forEach(({ corners, normal, axes }, face) => {
    for (const corner of corners) vertices.push(...corner, ...normal, ...axes);
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const shader = (type: number, source: string) => {
    const created = gl.createShader(type);
    if (!created) throw new Error("Could not create a WebGL shader.");
    gl.shaderSource(created, source);
    gl.compileShader(created);
    if (!gl.getShaderParameter(created, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`Note highway shader failed to compile: ${gl.getShaderInfoLog(created)}`);
    }
    return created;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create a WebGL program.");
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Note highway shader failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function uniforms<Name extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly Name[],
): Record<Name, WebGLUniformLocation | null> {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<Name, WebGLUniformLocation | null>;
}

interface GpuResources {
  noteProgram: WebGLProgram;
  floorProgram: WebGLProgram;
  lineProgram: WebGLProgram;
  noteUniforms: Record<
    "u_viewProjection" | "u_now" | "u_unitsPerTime" | "u_length" | "u_minLength" | "u_gap" |
    "u_whiteColor" | "u_blackColor",
    WebGLUniformLocation | null
  >;
  floorUniforms: Record<
    "u_viewProjection" | "u_halfWidth" | "u_length" | "u_blackHalfWidth" | "u_glow" |
    "u_whiteColor" | "u_blackColor",
    WebGLUniformLocation | null
  >;
  lineUniforms: Record<
    "u_viewProjection" | "u_now" | "u_unitsPerTime" | "u_halfWidth" | "u_length",
    WebGLUniformLocation | null
  >;
  noteVao: WebGLVertexArrayObject;
  floorVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  noteInstanceBuffer: WebGLBuffer;
  lineInstanceBuffer: WebGLBuffer;
  noteIndexCount: number;
  buffers: WebGLBuffer[];
}

/**
 * Draws the note highway with three instanced draw calls per frame. Note and
 * grid-line data are uploaded once per track; each frame only rebinds the
 * instance window that can be visible and updates a handful of uniforms, so the
 * per-frame cost does not grow with the length of the score. Track time is
 * whatever axis the track uses (seconds or note-by-note steps).
 */
export class NoteHighwayRenderer {
  private resources: GpuResources | null = null;
  private track: HighwayTrack | null = null;
  private camera: HighwayCamera | null = null;
  private readonly glow = new Float32Array(KEY_COUNT);
  private lastDraw = "";
  private sizeVersion = 0;
  private trackVersion = 0;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    this.resources = this.createResources();
  }

  static create(canvas: HTMLCanvasElement): NoteHighwayRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    return gl ? new NoteHighwayRenderer(canvas, gl) : null;
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.resources = null;
  };

  private readonly handleContextRestored = () => {
    this.resources = this.createResources();
    this.uploadTrack();
    this.lastDraw = "";
  };

  private createResources(): GpuResources {
    const gl = this.gl;
    const buffers: WebGLBuffer[] = [];
    const buffer = (target: number, data: BufferSource | null, usage: number) => {
      const created = gl.createBuffer();
      if (!created) throw new Error("Could not create a WebGL buffer.");
      gl.bindBuffer(target, created);
      if (data) gl.bufferData(target, data, usage);
      buffers.push(created);
      return created;
    };
    const vertexArray = () => {
      const created = gl.createVertexArray();
      if (!created) throw new Error("Could not create a WebGL vertex array.");
      gl.bindVertexArray(created);
      return created;
    };

    const noteProgram = compileProgram(gl, NOTE_VERTEX_SHADER, NOTE_FRAGMENT_SHADER);
    const floorProgram = compileProgram(gl, FLOOR_VERTEX_SHADER, FLOOR_FRAGMENT_SHADER);
    const lineProgram = compileProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);

    const box = noteBoxGeometry();
    const noteVao = vertexArray();
    buffer(gl.ARRAY_BUFFER, box.vertices, gl.STATIC_DRAW);
    const boxStride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, boxStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, boxStride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, boxStride, 6 * 4);
    buffer(gl.ELEMENT_ARRAY_BUFFER, box.indices, gl.STATIC_DRAW);
    const noteInstanceBuffer = buffer(gl.ARRAY_BUFFER, null, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribDivisor(4, 1);

    const floorVao = vertexArray();
    buffer(gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const lineVao = vertexArray();
    buffer(gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const lineInstanceBuffer = buffer(gl.ARRAY_BUFFER, null, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);

    return {
      noteProgram,
      floorProgram,
      lineProgram,
      noteUniforms: uniforms(gl, noteProgram, [
        "u_viewProjection", "u_now", "u_unitsPerTime", "u_length", "u_minLength", "u_gap",
        "u_whiteColor", "u_blackColor",
      ] as const),
      floorUniforms: uniforms(gl, floorProgram, [
        "u_viewProjection", "u_halfWidth", "u_length", "u_blackHalfWidth", "u_glow",
        "u_whiteColor", "u_blackColor",
      ] as const),
      lineUniforms: uniforms(gl, lineProgram, [
        "u_viewProjection", "u_now", "u_unitsPerTime", "u_halfWidth", "u_length",
      ] as const),
      noteVao,
      floorVao,
      lineVao,
      noteInstanceBuffer,
      lineInstanceBuffer,
      noteIndexCount: box.indices.length,
      buffers,
    };
  }

  private uploadTrack(): void {
    const resources = this.resources;
    if (!resources) return;
    const gl = this.gl;
    const empty = new Float32Array(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.noteInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.track?.notes.instances ?? empty, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.lineInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.track?.lines.instances ?? empty, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Uploads a new track; the same track object again is a no-op. */
  setTrack(track: HighwayTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    this.trackVersion += 1;
    this.uploadTrack();
    this.lastDraw = "";
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (width === this.canvas.width && height === this.canvas.height && this.camera) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.camera = cssHeight > 0 ? highwayCamera(cssWidth / cssHeight) : null;
    this.sizeVersion += 1;
    this.lastDraw = "";
  }

  /** Draws the highway at `now`; a no-op when nothing visible changed. */
  render(now: number, window: number): void {
    const resources = this.resources;
    const camera = this.camera;
    if (!resources || !camera || this.gl.isContextLost()) return;
    const drawKey = `${this.sizeVersion}:${this.trackVersion}:${now}:${window}`;
    if (drawKey === this.lastDraw) return;
    this.lastDraw = drawKey;

    const gl = this.gl;
    const unitsPerTime = camera.length / window;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    const notes = this.track?.notes ?? null;
    const range = notes
      ? visibleNoteRange(notes, now, window)
      : { start: 0, end: 0 };
    this.updateGlow(now, range.start);

    // Floor and grid lines lie flat on y = 0 under every note, so they skip the
    // depth buffer and the notes are depth-tested only against each other.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(resources.floorProgram);
    const floor = resources.floorUniforms;
    gl.uniformMatrix4fv(floor.u_viewProjection, false, camera.viewProjection);
    gl.uniform1f(floor.u_halfWidth, HIGHWAY_HALF_WIDTH);
    gl.uniform1f(floor.u_length, camera.length);
    gl.uniform1f(floor.u_blackHalfWidth, BLACK_KEY_LANE_HALF_WIDTH);
    gl.uniform4fv(floor.u_glow, this.glow);
    gl.uniform3fv(floor.u_whiteColor, WHITE_NOTE_COLOR);
    gl.uniform3fv(floor.u_blackColor, BLACK_NOTE_COLOR);
    gl.bindVertexArray(resources.floorVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const lines = this.track?.lines ?? null;
    if (lines && lines.count > 0) {
      const lineStart = lowerBound(lines.times, lines.count, now);
      const lineEnd = upperBound(lines.times, lines.count, now + window);
      if (lineEnd > lineStart) {
        gl.useProgram(resources.lineProgram);
        const line = resources.lineUniforms;
        gl.uniformMatrix4fv(line.u_viewProjection, false, camera.viewProjection);
        gl.uniform1f(line.u_now, now);
        gl.uniform1f(line.u_unitsPerTime, unitsPerTime);
        gl.uniform1f(line.u_halfWidth, HIGHWAY_HALF_WIDTH);
        gl.uniform1f(line.u_length, camera.length);
        gl.bindVertexArray(resources.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.lineInstanceBuffer);
        gl.vertexAttribPointer(
          1, 2, gl.FLOAT, false,
          GRID_LINE_INSTANCE_FLOATS * 4,
          lineStart * GRID_LINE_INSTANCE_FLOATS * 4,
        );
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, lineEnd - lineStart);
      }
    }

    if (notes && range.end > range.start) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(resources.noteProgram);
      const note = resources.noteUniforms;
      gl.uniformMatrix4fv(note.u_viewProjection, false, camera.viewProjection);
      gl.uniform1f(note.u_now, now);
      gl.uniform1f(note.u_unitsPerTime, unitsPerTime);
      gl.uniform1f(note.u_length, camera.length);
      gl.uniform1f(note.u_minLength, MIN_NOTE_LENGTH);
      gl.uniform1f(note.u_gap, REPEAT_GAP);
      gl.uniform3fv(note.u_whiteColor, WHITE_NOTE_COLOR);
      gl.uniform3fv(note.u_blackColor, BLACK_NOTE_COLOR);
      gl.bindVertexArray(resources.noteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.noteInstanceBuffer);
      const stride = NOTE_INSTANCE_FLOATS * 4;
      const offset = range.start * stride;
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, offset);
      gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, offset + 4 * 4);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        resources.noteIndexCount,
        gl.UNSIGNED_SHORT,
        0,
        range.end - range.start,
      );
    }
    gl.bindVertexArray(null);
  }

  /** Per-key approach progress for the current track; see keyApproachProgress. */
  keyApproach(now: number, window: number, out: Float32Array): void {
    if (this.track) keyApproachProgress(this.track.notes, now, window, out);
    else out.fill(0);
  }

  /** Lights the lane of every note sounding at `now`. */
  private updateGlow(now: number, rangeStart: number): void {
    this.glow.fill(0);
    const notes = this.track?.notes;
    if (!notes) return;
    const sounding = upperBound(notes.starts, notes.count, now);
    for (let index = rangeStart; index < sounding; index += 1) {
      if (notes.ends[index] > now) this.glow[notes.midis[index] - 21] = 1;
    }
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const resources = this.resources;
    const gl = this.gl;
    if (resources && !gl.isContextLost()) {
      gl.deleteProgram(resources.noteProgram);
      gl.deleteProgram(resources.floorProgram);
      gl.deleteProgram(resources.lineProgram);
      gl.deleteVertexArray(resources.noteVao);
      gl.deleteVertexArray(resources.floorVao);
      gl.deleteVertexArray(resources.lineVao);
      for (const buffer of resources.buffers) gl.deleteBuffer(buffer);
    }
    this.resources = null;
    // Release the context now rather than whenever the canvas is collected, so
    // toggling the highway repeatedly cannot exhaust the browser's context limit.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
