import {
  colorChannels,
  FULL_KEYBOARD_RANGE,
  handColors,
  DEFAULT_KEYBOARD_VIEW_SETTINGS,
  type HandColors,
  type HighwayNoteStyle,
  type KeyboardRange,
} from "../keyboardView";
import {
  BLACK_KEY_LANE_HALF_WIDTH,
  DEFAULT_HIGHWAY_TILT_DEGREES,
  GRID_LINE_INSTANCE_FLOATS,
  HIGHWAY_HALF_WIDTH,
  highwayCamera,
  highwayLayout,
  keyApproachProgress,
  lowerBound,
  NOTE_HEIGHTS,
  NOTE_INSTANCE_FLOATS,
  upperBound,
  visibleNoteRange,
  type HighwayCamera,
  type HighwayLayout,
  type HighwayTrack,
} from "./highwayModel";

const KEY_COUNT = 88;
/** Shortest drawn block and the gap that separates repeated notes, in world units. */
const MIN_NOTE_LENGTH = 0.35;
const REPEAT_GAP = 0.12;

const GHOST_NOTE_COLOR = new Float32Array([0.66, 0.69, 0.74]);

/** How the highway looks; everything but the track and the time. */
export interface HighwayRenderView {
  range: KeyboardRange;
  tilt: number;
  /** A 3D keyboard lies on the floor in front of the hit line, inside this canvas. */
  keyboard3d: boolean;
  colors: HandColors;
  noteStyle: HighwayNoteStyle;
  fingerNumbers: boolean;
}

export const DEFAULT_HIGHWAY_RENDER_VIEW: Readonly<HighwayRenderView> = Object.freeze({
  range: FULL_KEYBOARD_RANGE,
  tilt: DEFAULT_HIGHWAY_TILT_DEGREES,
  keyboard3d: false,
  colors: handColors(DEFAULT_KEYBOARD_VIEW_SETTINGS),
  noteStyle: "raised",
  fingerNumbers: true,
});

/** Glyph cells of the finger-number atlas, 1 to 5 left to right. */
const DIGIT_CELL = 64;

const NOTE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_corner;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_axes;
layout(location = 3) in vec4 a_lane; // centre, half width, black, left hand
layout(location = 4) in vec4 a_time; // start, end, ghost, finger

uniform mat4 u_viewProjection;
uniform float u_now;
uniform float u_unitsPerTime;
uniform float u_length;
uniform float u_minLength;
uniform float u_gap;
uniform vec2 u_heights; // white, black
uniform vec2 u_laneSpan; // the keys shown, as world x from and to

out vec3 v_normal;
out vec2 v_uv;
out vec2 v_faceSize;
out float v_far;
out float v_black;
out float v_left;
out float v_sounding;
out float v_ghost;
out float v_finger;

void main() {
  float headZ = -(a_time.x - u_now) * u_unitsPerTime;
  float tailZ = min(-(a_time.y - u_now) * u_unitsPerTime + u_gap, headZ - u_minLength);
  // The part of a note already past the hit line has gone into the keyboard.
  float nearZ = min(headZ, 0.0);
  float farZ = max(tailZ, -u_length);
  // Notes of keys the keyboard leaves out, such as the other hand's, have no lane.
  bool offKeyboard = a_lane.x < u_laneSpan.x || a_lane.x > u_laneSpan.y;
  if (farZ >= nearZ - 1e-4 || offKeyboard) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 size = vec3(2.0 * a_lane.y, mix(u_heights.x, u_heights.y, a_lane.z), nearZ - farZ);
  vec3 world = vec3(a_lane.x - a_lane.y, 0.0, farZ) + a_corner * size;
  gl_Position = u_viewProjection * vec4(world, 1.0);
  v_normal = a_normal;
  v_uv = vec2(a_corner[int(a_axes.x)], a_corner[int(a_axes.y)]);
  v_faceSize = vec2(size[int(a_axes.x)], size[int(a_axes.y)]);
  v_far = clamp(-world.z / u_length, 0.0, 1.0);
  v_black = a_lane.z;
  v_left = a_lane.w;
  v_sounding = headZ >= 0.0 ? 1.0 : 0.0;
  v_ghost = a_time.z;
  v_finger = a_time.w;
}`;

const NOTE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in vec2 v_faceSize;
in float v_far;
in float v_black;
in float v_left;
in float v_sounding;
in float v_ghost;
in float v_finger;

uniform vec3 u_rightColor;
uniform vec3 u_rightDark;
uniform vec3 u_leftColor;
uniform vec3 u_leftDark;
uniform vec3 u_ghostColor;
uniform float u_flat;
uniform float u_showFingers;
uniform sampler2D u_digits;

out vec4 outColor;

void main() {
  // Each hand has its colour, darker on black keys. The other hand's notes keep
  // their shape but lose their colour and most of their opacity, so they show
  // where that hand plays without competing.
  vec3 handColor = mix(
    mix(u_rightColor, u_rightDark, v_black),
    mix(u_leftColor, u_leftDark, v_black),
    v_left
  );
  vec3 base = mix(handColor, u_ghostColor, v_ghost);
  vec3 light = normalize(vec3(-0.35, 0.85, 0.45));
  float diffuse = max(dot(normalize(v_normal), light), 0.0);
  // Flat tiles are evenly coloured; raised blocks are shaded and edged.
  vec3 color = mix(base * (0.38 + 0.72 * diffuse), base, u_flat);
  vec2 facePoint = v_uv * v_faceSize;
  vec2 edgeDistance = min(v_uv, 1.0 - v_uv) * v_faceSize;
  float edge = 1.0 - smoothstep(0.025, 0.075, min(edgeDistance.x, edgeDistance.y));
  color = mix(color, vec3(1.0), edge * mix(0.5, 0.2, v_ghost) * (1.0 - u_flat));
  color = mix(color, min(base * 1.6 + 0.25, vec3(1.0)), v_sounding * 0.55 * (1.0 - v_ghost));
  float alpha = (1.0 - smoothstep(0.6, 1.0, v_far)) * mix(1.0, 0.3, v_ghost);

  // Flat tiles get rounded corners.
  vec2 halfSize = v_faceSize * 0.5;
  float radius = min(0.14, 0.45 * min(halfSize.x, halfSize.y));
  vec2 corner = abs(facePoint - halfSize) - (halfSize - radius);
  float cornerDistance = length(max(corner, 0.0)) - radius;
  // fwidth is 0 away from the corners, and smoothstep needs distinct edges.
  float smoothing = max(fwidth(cornerDistance), 1e-4);
  float rounded = 1.0 - smoothstep(-smoothing, smoothing, cornerDistance);
  alpha *= mix(1.0, rounded, u_flat);

  // The finger number sits at the near end of the top face, reading upright.
  bool top = v_normal.y > 0.5;
  float side = min(v_faceSize.x * 0.86, v_faceSize.y - 0.16);
  float fromNear = (1.0 - v_uv.y) * v_faceSize.y - 0.08;
  vec2 cell = vec2(facePoint.x - (v_faceSize.x - side) * 0.5, fromNear) / max(side, 1e-3);
  vec2 digitUv = vec2((clamp(v_finger, 1.0, 5.0) - 1.0 + clamp(cell.x, 0.0, 1.0)) / 5.0, 1.0 - clamp(cell.y, 0.0, 1.0));
  float glyph = texture(u_digits, digitUv).a;
  float inCell = step(0.0, cell.x) * step(cell.x, 1.0) * step(0.0, cell.y) * step(cell.y, 1.0);
  float showDigit = u_showFingers * step(0.5, v_finger) * (1.0 - v_ghost) * (top ? 1.0 : 0.0) * step(0.22, side);
  float luminance = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 ink = luminance > 0.55 ? vec3(0.06, 0.14, 0.13) : vec3(1.0);
  color = mix(color, ink, glyph * inCell * showDigit);

  if (alpha <= 0.002) discard;
  outColor = vec4(color * alpha, alpha);
}`;

const FLOOR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_corner;

uniform mat4 u_viewProjection;
uniform float u_center;
uniform float u_halfWidth;
uniform float u_length;

out vec2 v_world;

void main() {
  v_world = vec2(u_center - u_halfWidth + a_corner.x * 2.0 * u_halfWidth, -a_corner.y * u_length);
  gl_Position = u_viewProjection * vec4(v_world.x, 0.0, v_world.y, 1.0);
}`;

const FLOOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_world;

uniform float u_center;
uniform float u_halfWidth;
uniform float u_keyboardHalfWidth;
uniform float u_length;
uniform float u_blackHalfWidth;
// Per key: 0 dark, 1 lit by the right hand, 2 by the left.
uniform vec4 u_glow[22];
uniform vec3 u_rightColor;
uniform vec3 u_leftColor;

out vec4 outColor;

// Semitones above A for the white keys A B C D E F G.
const int WHITE_OFFSETS[7] = int[7](0, 2, 3, 5, 7, 8, 10);

bool hasSharp(int letter) {
  return letter == 0 || letter == 2 || letter == 3 || letter == 5 || letter == 6;
}

void main() {
  float keyX = v_world.x + u_keyboardHalfWidth;
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
  float glowHand = u_glow[key >> 2][key & 3];
  float glow = step(0.5, glowHand);
  vec3 glowColor = glowHand > 1.5 ? u_leftColor : u_rightColor;
  color += glowColor * glow * (0.18 + 0.5 * (1.0 - smoothstep(0.0, 0.45, far)));

  float hit = 1.0 - smoothstep(0.06, 0.06 + fwidth(v_world.y) * 1.5 + 0.12, -v_world.y);
  float rail = 1.0 - smoothstep(0.08, 0.08 + pixel * 1.5, u_halfWidth - abs(v_world.x - u_center));
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
uniform float u_center;
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
  // Bar and beat lines by strength; the loop line, stronger than both, is thicker still.
  float thickness = mix(0.05, 0.12, a_line.y);
  vec3 world = vec3(
    u_center - u_halfWidth + a_corner.x * 2.0 * u_halfWidth,
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
  float loopLine = step(1.5, v_strength);
  float alpha = min(v_strength * 0.5, 0.95) * profile * (1.0 - smoothstep(0.35, 1.0, v_far));
  // The loop line takes the score's loop colour, #D98A1C.
  vec3 color = mix(vec3(0.82, 0.88, 0.92), vec3(0.851, 0.541, 0.11), loopLine);
  outColor = vec4(color * alpha, alpha);
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

const NOTE_UNIFORMS = [
  "u_viewProjection", "u_now", "u_unitsPerTime", "u_length", "u_minLength", "u_gap", "u_heights", "u_laneSpan",
  "u_rightColor", "u_rightDark", "u_leftColor", "u_leftDark", "u_ghostColor",
  "u_flat", "u_showFingers", "u_digits",
] as const;
const FLOOR_UNIFORMS = [
  "u_viewProjection", "u_center", "u_halfWidth", "u_keyboardHalfWidth", "u_length",
  "u_blackHalfWidth", "u_glow", "u_rightColor", "u_leftColor",
] as const;
const LINE_UNIFORMS = [
  "u_viewProjection", "u_now", "u_unitsPerTime", "u_center", "u_halfWidth", "u_length",
] as const;

/** White digits 1 to 5 on transparent cells, sampled by alpha. */
function drawDigitAtlas(): HTMLCanvasElement | OffscreenCanvas | null {
  const width = DIGIT_CELL * 5;
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, DIGIT_CELL)
    : typeof document !== "undefined"
      ? Object.assign(document.createElement("canvas"), { width, height: DIGIT_CELL })
      : null;
  const context = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!canvas || !context) return null;
  context.clearRect(0, 0, width, DIGIT_CELL);
  context.fillStyle = "#fff";
  context.font = `700 ${Math.round(DIGIT_CELL * 0.8)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let finger = 1; finger <= 5; finger += 1) {
    context.fillText(String(finger), (finger - 0.5) * DIGIT_CELL, DIGIT_CELL * 0.54);
  }
  return canvas;
}

interface GpuResources {
  noteProgram: WebGLProgram;
  floorProgram: WebGLProgram;
  lineProgram: WebGLProgram;
  noteUniforms: Record<(typeof NOTE_UNIFORMS)[number], WebGLUniformLocation | null>;
  floorUniforms: Record<(typeof FLOOR_UNIFORMS)[number], WebGLUniformLocation | null>;
  lineUniforms: Record<(typeof LINE_UNIFORMS)[number], WebGLUniformLocation | null>;
  digitTexture: WebGLTexture;
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
  private layout: HighwayLayout | null = null;
  private view: HighwayRenderView = DEFAULT_HIGHWAY_RENDER_VIEW;
  private cssSize = { width: 0, height: 0 };
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

    const digitTexture = gl.createTexture();
    if (!digitTexture) throw new Error("Could not create a WebGL texture.");
    gl.bindTexture(gl.TEXTURE_2D, digitTexture);
    const atlas = drawDigitAtlas();
    if (atlas) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, atlas ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return {
      noteProgram,
      floorProgram,
      lineProgram,
      noteUniforms: uniforms(gl, noteProgram, NOTE_UNIFORMS),
      floorUniforms: uniforms(gl, floorProgram, FLOOR_UNIFORMS),
      lineUniforms: uniforms(gl, lineProgram, LINE_UNIFORMS),
      digitTexture,
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
    if (
      width === this.canvas.width && height === this.canvas.height && this.camera &&
      cssWidth === this.cssSize.width && cssHeight === this.cssSize.height
    ) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.cssSize = { width: cssWidth, height: cssHeight };
    this.placeCamera();
  }

  /** A new look for the highway; the same view object again is a no-op. */
  setView(view: HighwayRenderView): void {
    if (view === this.view) return;
    const moved = view.range.low !== this.view.range.low || view.range.high !== this.view.range.high ||
      view.tilt !== this.view.tilt || view.keyboard3d !== this.view.keyboard3d;
    this.view = view;
    if (moved) this.placeCamera();
    else {
      this.sizeVersion += 1;
      this.lastDraw = "";
    }
  }

  private placeCamera(): void {
    const { width, height } = this.cssSize;
    this.layout = height > 0 ? highwayLayout(this.view, width, height) : null;
    this.camera = this.layout ? highwayCamera(width / height, this.layout) : null;
    this.sizeVersion += 1;
    this.lastDraw = "";
  }

  /** Draws the highway at `now`; a no-op when nothing visible changed. */
  render(now: number, window: number): void {
    const resources = this.resources;
    const camera = this.camera;
    const layout = this.layout;
    if (!resources || !camera || !layout || this.gl.isContextLost()) return;
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
    const colors = this.view.colors;
    gl.uniformMatrix4fv(floor.u_viewProjection, false, camera.viewProjection);
    gl.uniform1f(floor.u_center, layout.center);
    gl.uniform1f(floor.u_halfWidth, layout.halfWidth);
    gl.uniform1f(floor.u_keyboardHalfWidth, HIGHWAY_HALF_WIDTH);
    gl.uniform1f(floor.u_length, camera.length);
    gl.uniform1f(floor.u_blackHalfWidth, BLACK_KEY_LANE_HALF_WIDTH);
    gl.uniform4fv(floor.u_glow, this.glow);
    gl.uniform3fv(floor.u_rightColor, colorChannels(colors.right.base));
    gl.uniform3fv(floor.u_leftColor, colorChannels(colors.left.base));
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
        gl.uniform1f(line.u_center, layout.center);
        gl.uniform1f(line.u_halfWidth, layout.halfWidth);
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
      const heights = NOTE_HEIGHTS[this.view.noteStyle];
      gl.uniform2f(note.u_heights, heights.white, heights.black);
      gl.uniform2f(note.u_laneSpan, layout.center - layout.halfWidth, layout.center + layout.halfWidth);
      gl.uniform3fv(note.u_rightColor, colorChannels(colors.right.base));
      gl.uniform3fv(note.u_rightDark, colorChannels(colors.right.dark));
      gl.uniform3fv(note.u_leftColor, colorChannels(colors.left.base));
      gl.uniform3fv(note.u_leftDark, colorChannels(colors.left.dark));
      gl.uniform3fv(note.u_ghostColor, GHOST_NOTE_COLOR);
      gl.uniform1f(note.u_flat, this.view.noteStyle === "flat" ? 1 : 0);
      gl.uniform1f(note.u_showFingers, this.view.fingerNumbers ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resources.digitTexture);
      gl.uniform1i(note.u_digits, 0);
      gl.bindVertexArray(resources.noteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.noteInstanceBuffer);
      const stride = NOTE_INSTANCE_FLOATS * 4;
      const offset = range.start * stride;
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, offset);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, offset + 4 * 4);
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

  /** Per-key approach progress and hand for the current track; see keyApproachProgress. */
  keyApproach(now: number, window: number, out: Float32Array, hands?: Uint8Array): void {
    if (this.track) keyApproachProgress(this.track.notes, now, window, out, hands);
    else {
      out.fill(0);
      hands?.fill(0);
    }
  }

  /** Lights the lane of every note sounding at `now` in its hand's colour. */
  private updateGlow(now: number, rangeStart: number): void {
    this.glow.fill(0);
    const notes = this.track?.notes;
    if (!notes) return;
    const sounding = upperBound(notes.starts, notes.count, now);
    for (let index = rangeStart; index < sounding; index += 1) {
      if (notes.ends[index] > now && !notes.ghosts[index]) {
        this.glow[notes.midis[index] - 21] = notes.lefts[index] ? 2 : 1;
      }
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
      gl.deleteTexture(resources.digitTexture);
      for (const buffer of resources.buffers) gl.deleteBuffer(buffer);
    }
    this.resources = null;
    // Release the context now rather than whenever the canvas is collected, so
    // toggling the highway repeatedly cannot exhaust the browser's context limit.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
