import * as Tone from "tone";
import { ONLINE_AMT_CHUNK_SIZE, ONLINE_AMT_SAMPLE_RATE } from "./onlineAmtProtocol";
import {
  createTonePianoLayeredGraph,
  midiToPitchName,
  PIANO_NOTE_RELEASE_SECONDS,
  pianoChordVelocity,
  type TonePianoLayeredGraph,
} from "./piano";
import {
  DEFAULT_PIANO_ID,
  isPianoLayerFor,
  pianoDefinition,
  pianoSampleUrlsForLayer,
  type PianoId,
  type PianoLayerId,
} from "./pianoRegistry";

export const LISTEN_BENCHMARK_DEFAULT_HOLD_MS = 420;
export const LISTEN_BENCHMARK_RELEASE_MS = 350;

export interface ListenBenchmarkRendererConfiguration {
  version: "bundled-piano-web-audio-v1" | "bundled-piano-tone-v2";
  sampleRate: 16_000;
  chunkSize: 512;
  defaultHoldMs: 420;
  releaseMs: 350;
  normalization: "none";
}

export const LISTEN_BENCHMARK_RENDERER: ListenBenchmarkRendererConfiguration = Object.freeze({
  version: "bundled-piano-web-audio-v1",
  sampleRate: ONLINE_AMT_SAMPLE_RATE,
  chunkSize: ONLINE_AMT_CHUNK_SIZE,
  defaultHoldMs: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  releaseMs: LISTEN_BENCHMARK_RELEASE_MS,
  normalization: "none",
});

export const LISTEN_BENCHMARK_TONE_RENDERER: ListenBenchmarkRendererConfiguration =
  Object.freeze({
    version: "bundled-piano-tone-v2",
    sampleRate: ONLINE_AMT_SAMPLE_RATE,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
    defaultHoldMs: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
    releaseMs: LISTEN_BENCHMARK_RELEASE_MS,
    normalization: "none",
  });

export const LISTEN_BENCHMARK_RENDERERS = Object.freeze([
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
]);

export interface ListenBenchmarkAudioNote {
  midi: number;
  /** Offset from the containing physical attack. Fractional milliseconds are preserved. */
  offsetMs?: number;
  /** Overrides the attack's hold time for this note only. */
  holdMs?: number;
  /** Overrides the attack's release time for this note only. */
  releaseMs?: number;
}

export interface ListenBenchmarkAudioAttack {
  onsetMs: number;
  notes: readonly (number | ListenBenchmarkAudioNote)[];
  /**
   * Chord size used for per-note level when a physical attack contains only
   * the newly introduced notes of a larger sounding chord.
   */
  gainReferenceChordSize?: number;
  holdMs?: number;
  releaseMs?: number;
  /** Recorded acoustic layer; chord mix gain never changes this selection. */
  layer?: PianoLayerId;
}

export type ListenBenchmarkDynamicProfile = "constant" | "crescendo-decrescendo";

export interface ListenBenchmarkPianoConfiguration {
  id: PianoId;
  displayName: string;
  layer: PianoLayerId | null;
  layers: PianoLayerId[];
  dynamicProfile: ListenBenchmarkDynamicProfile;
  sampleLibraryVersion: string;
}

export const LISTEN_BENCHMARK_PIANO: ListenBenchmarkPianoConfiguration = Object.freeze({
  id: "splendid",
  displayName: pianoDefinition("splendid").displayName,
  layer: "mp",
  layers: ["mp"] as PianoLayerId[],
  dynamicProfile: "constant",
  sampleLibraryVersion: pianoDefinition("splendid").source.version,
});

export interface ListenBenchmarkAudioDiagnostics {
  frameCount: number;
  durationMs: number;
  peak: number;
  rms: number;
  /** Added by inference traces so paired passes can prove byte-identical input. */
  audioSignature?: ListenBenchmarkAudioSignature;
}

export interface ListenBenchmarkAudioSignature {
  sampleRate: number;
  chunkSize: number;
  frameCount: number;
  pcmByteLength: number;
  pcmHash: string;
  chunkHashes: string[];
}

export interface ListenBenchmarkAudioRenderResult {
  pcm: Float32Array;
  renderer: ListenBenchmarkRendererConfiguration;
  diagnostics: ListenBenchmarkAudioDiagnostics;
  piano: ListenBenchmarkPianoConfiguration;
}

export interface RenderBenchmarkAudioOptions {
  attacks: readonly ListenBenchmarkAudioAttack[];
  durationMs: number;
  sampleRate?: number;
  chunkSize?: number;
  renderer?: ListenBenchmarkRendererConfiguration;
  piano?: PianoId;
  layer?: PianoLayerId;
  dynamicProfile?: ListenBenchmarkDynamicProfile;
}

export type ListenBenchmarkAudioRenderer = (
  options: RenderBenchmarkAudioOptions,
) => Promise<ListenBenchmarkAudioRenderResult>;

interface PreparedPianoSample {
  sourceMidi: number;
  buffer: AudioBuffer;
}

let decodingContext: OfflineAudioContext | null = null;
const decodedSamples = new Map<string, Promise<AudioBuffer>>();

function contextForDecoding(): OfflineAudioContext {
  // Decoding into the canonical rate makes the cached AudioBuffer independent of
  // the host's output-device rate. Offline contexts do not need user activation.
  decodingContext ??= new OfflineAudioContext(1, 1, ONLINE_AMT_SAMPLE_RATE);
  return decodingContext;
}

function nearestBundledSample(
  midi: number,
  piano: PianoId,
  layer: PianoLayerId,
): [number, string] {
  const samples = Object.entries(pianoSampleUrlsForLayer(piano, layer)).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => (
    Math.abs(candidate[0] - midi) < Math.abs(nearest[0] - midi) ? candidate : nearest
  ));
}

async function preparedSample(
  midi: number,
  piano: PianoId,
  layer: PianoLayerId,
): Promise<PreparedPianoSample> {
  const [sourceMidi, url] = nearestBundledSample(midi, piano, layer);
  let pending = decodedSamples.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load benchmark sample ${url}.`);
      return contextForDecoding().decodeAudioData(await response.arrayBuffer());
    });
    decodedSamples.set(url, pending);
  }
  return { sourceMidi, buffer: await pending };
}

function nearestToneBundledSample(
  midi: number,
  piano: PianoId,
  layer: PianoLayerId,
): [number, string] {
  const samples = Object.entries(pianoSampleUrlsForLayer(piano, layer)).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(candidate[0] - midi);
    const nearestDistance = Math.abs(nearest[0] - midi);
    return candidateDistance < nearestDistance ||
      (candidateDistance === nearestDistance && candidate[0] > nearest[0])
      ? candidate
      : nearest;
  });
}

async function preparedToneSample(
  midi: number,
  piano: PianoId,
  layer: PianoLayerId,
): Promise<PreparedPianoSample> {
  const [sourceMidi, url] = nearestToneBundledSample(midi, piano, layer);
  let pending = decodedSamples.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load benchmark sample ${url}.`);
      return contextForDecoding().decodeAudioData(await response.arrayBuffer());
    });
    decodedSamples.set(url, pending);
  }
  return { sourceMidi, buffer: await pending };
}

function normalizedNote(note: number | ListenBenchmarkAudioNote): ListenBenchmarkAudioNote {
  return typeof note === "number" ? { midi: note } : note;
}

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number, received ${value}.`);
  }
}

function pianoConfiguration(options: RenderBenchmarkAudioOptions): ListenBenchmarkPianoConfiguration {
  const id = options.piano ?? DEFAULT_PIANO_ID;
  const definition = pianoDefinition(id);
  const fallbackLayer = options.layer ?? definition.defaultLayer;
  if (!isPianoLayerFor(id, fallbackLayer)) {
    throw new Error(`Piano layer ${fallbackLayer} does not belong to ${id}.`);
  }
  const layers = [...new Set(options.attacks.map((attack) => attack.layer ?? fallbackLayer))];
  for (const layer of layers) {
    if (!isPianoLayerFor(id, layer)) {
      throw new Error(`Piano layer ${layer} does not belong to ${id}.`);
    }
  }
  return {
    id,
    displayName: definition.displayName,
    layer: layers.length === 1 ? layers[0] : null,
    layers,
    dynamicProfile: options.dynamicProfile ?? (layers.length === 1
      ? "constant"
      : "crescendo-decrescendo"),
    sampleLibraryVersion: definition.source.version,
  };
}

export function benchmarkChordGain(chordSize: number): number {
  if (!Number.isInteger(chordSize) || chordSize <= 0) {
    throw new Error(
      `Benchmark gain-reference chord size must be a positive integer, received ${chordSize}.`,
    );
  }
  return Math.min(0.8, 0.9 / Math.sqrt(chordSize));
}

function alignedFrameCount(durationMs: number, sampleRate: number, chunkSize: number): number {
  requireFiniteNonNegative("Benchmark durationMs", durationMs);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Benchmark sampleRate must be a positive integer, received ${sampleRate}.`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Benchmark chunkSize must be a positive integer, received ${chunkSize}.`);
  }
  return Math.max(chunkSize, Math.ceil(
    durationMs * sampleRate / 1_000 / chunkSize,
  ) * chunkSize);
}

export function measureBenchmarkPcm(
  pcm: Float32Array,
  sampleRate = ONLINE_AMT_SAMPLE_RATE,
): ListenBenchmarkAudioDiagnostics {
  let peak = 0;
  let sumSquares = 0;
  for (const value of pcm) {
    peak = Math.max(peak, Math.abs(value));
    sumSquares += value * value;
  }
  return {
    frameCount: pcm.length,
    durationMs: pcm.length * 1_000 / sampleRate,
    peak,
    rms: pcm.length === 0 ? 0 : Math.sqrt(sumSquares / pcm.length),
  };
}

function hashBytes(bytes: Uint8Array): string {
  // FNV-1a is small, deterministic in every browser, and sufficient for the
  // diagnostic identity check. The benchmark still compares the actual PCM
  // length and chunk layout alongside this hash.
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function signatureForBenchmarkPcm(
  pcm: Float32Array,
  sampleRate = ONLINE_AMT_SAMPLE_RATE,
  chunkSize = ONLINE_AMT_CHUNK_SIZE,
): ListenBenchmarkAudioSignature {
  if (pcm.length % chunkSize !== 0) {
    throw new Error(`Cannot sign PCM with incomplete ${chunkSize}-sample chunks.`);
  }
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkHashes = [] as string[];
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    const chunk = pcm.subarray(offset, offset + chunkSize);
    chunkHashes.push(hashBytes(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  }
  return {
    sampleRate,
    chunkSize,
    frameCount: pcm.length,
    pcmByteLength: bytes.byteLength,
    pcmHash: hashBytes(bytes),
    chunkHashes,
  };
}

/**
 * Preserves the original direct sample mixer as the canonical historical renderer.
 * No completed-buffer normalization is performed; level is fixed per physical attack.
 */
async function renderLegacyBenchmarkAudio(
  options: RenderBenchmarkAudioOptions,
): Promise<ListenBenchmarkAudioRenderResult> {
  const sampleRate = options.sampleRate ?? ONLINE_AMT_SAMPLE_RATE;
  const chunkSize = options.chunkSize ?? ONLINE_AMT_CHUNK_SIZE;
  if (sampleRate !== ONLINE_AMT_SAMPLE_RATE || chunkSize !== ONLINE_AMT_CHUNK_SIZE) {
    throw new Error(
      `The canonical benchmark renderer requires ${ONLINE_AMT_SAMPLE_RATE} Hz and ` +
      `${ONLINE_AMT_CHUNK_SIZE}-sample chunks.`,
    );
  }
  const frameCount = alignedFrameCount(options.durationMs, sampleRate, chunkSize);
  const piano = pianoConfiguration(options);
  const fallbackLayer = options.layer ?? pianoDefinition(piano.id).defaultLayer;
  const prepared = new Map<string, PreparedPianoSample>();
  const notes = options.attacks.flatMap((attack) => attack.notes.map((note) => ({
    note: normalizedNote(note),
    layer: attack.layer ?? fallbackLayer,
  })));
  await Promise.all([...new Map(notes.map(({ note, layer }) => [
    `${layer}:${note.midi}`,
    { midi: note.midi, layer },
  ])).values()].map(async ({ midi, layer }) => {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
      throw new Error(`Benchmark MIDI notes must be integers from 0 to 127, received ${midi}.`);
    }
    prepared.set(`${layer}:${midi}`, await preparedSample(midi, piano.id, layer));
  }));

  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  for (const attack of options.attacks) {
    requireFiniteNonNegative("Benchmark attack onsetMs", attack.onsetMs);
    const gainReferenceChordSize = attack.gainReferenceChordSize ?? attack.notes.length;
    const chordGain = benchmarkChordGain(gainReferenceChordSize);
    const layer = attack.layer ?? fallbackLayer;
    for (const rawNote of attack.notes) {
      const note = normalizedNote(rawNote);
      const offsetMs = note.offsetMs ?? 0;
      const holdMs = note.holdMs ?? attack.holdMs ?? LISTEN_BENCHMARK_DEFAULT_HOLD_MS;
      const releaseMs = note.releaseMs ?? attack.releaseMs ?? LISTEN_BENCHMARK_RELEASE_MS;
      requireFiniteNonNegative("Benchmark note offsetMs", offsetMs);
      requireFiniteNonNegative("Benchmark note holdMs", holdMs);
      requireFiniteNonNegative("Benchmark note releaseMs", releaseMs);
      const sample = prepared.get(`${layer}:${note.midi}`);
      if (!sample) throw new Error(`No bundled piano sample was prepared for MIDI ${note.midi}.`);

      const startsAt = (attack.onsetMs + offsetMs) / 1_000;
      const releasesAt = startsAt + holdMs / 1_000;
      const endsAt = releasesAt + releaseMs / 1_000;
      const source = offline.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = 2 ** ((note.midi - sample.sourceMidi) / 12);
      const envelope = offline.createGain();
      // The recording supplies the piano's attack shape. This gain envelope fixes
      // attack level, hold, and the existing 350 ms linear benchmark release.
      envelope.gain.setValueAtTime(chordGain, startsAt);
      envelope.gain.setValueAtTime(chordGain, releasesAt);
      envelope.gain.linearRampToValueAtTime(0, endsAt);
      source.connect(envelope).connect(offline.destination);
      source.start(startsAt);
      source.stop(endsAt);
    }
  }
  const rendered = await offline.startRendering();
  const pcm = new Float32Array(rendered.getChannelData(0));
  return {
    pcm,
    renderer: { ...LISTEN_BENCHMARK_RENDERER },
    diagnostics: measureBenchmarkPcm(pcm, sampleRate),
    piano,
  };
}

async function renderToneBenchmarkAudio(
  options: RenderBenchmarkAudioOptions,
): Promise<ListenBenchmarkAudioRenderResult> {
  const sampleRate = options.sampleRate ?? ONLINE_AMT_SAMPLE_RATE;
  const chunkSize = options.chunkSize ?? ONLINE_AMT_CHUNK_SIZE;
  if (sampleRate !== ONLINE_AMT_SAMPLE_RATE || chunkSize !== ONLINE_AMT_CHUNK_SIZE) {
    throw new Error(
      `The Tone benchmark renderer requires ${ONLINE_AMT_SAMPLE_RATE} Hz and ` +
      `${ONLINE_AMT_CHUNK_SIZE}-sample chunks.`,
    );
  }
  const frameCount = alignedFrameCount(options.durationMs, sampleRate, chunkSize);
  const piano = pianoConfiguration(options);
  const fallbackLayer = options.layer ?? pianoDefinition(piano.id).defaultLayer;
  const notes = options.attacks.flatMap((attack) => attack.notes.map((note) => ({
    note: normalizedNote(note),
    layer: attack.layer ?? fallbackLayer,
  })));
  const prepared = await Promise.all([...new Map(notes.map(({ note, layer }) => [
    `${layer}:${note.midi}`,
    { midi: note.midi, layer },
  ])).values()].map(
    async ({ midi, layer }) => {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
        throw new Error(`Benchmark MIDI notes must be integers from 0 to 127, received ${midi}.`);
      }
      return { layer, prepared: await preparedToneSample(midi, piano.id, layer) };
    },
  ));
  const samplesByLayer = new Map<PianoLayerId, Record<number, AudioBuffer>>();
  for (const { layer, prepared: sample } of prepared) {
    const samples = samplesByLayer.get(layer) ?? {};
    samples[sample.sourceMidi] = sample.buffer;
    samplesByLayer.set(layer, samples);
  }
  const graphs: TonePianoLayeredGraph[] = [];
  try {
    const rendered = await Tone.Offline(async (context) => {
      const graph = createTonePianoLayeredGraph(
        context,
        samplesByLayer,
        pianoDefinition(piano.id).samplerVolumeDb,
      );
      graphs.push(graph);
      await graph.loaded;
      for (const attack of options.attacks) {
        requireFiniteNonNegative("Benchmark attack onsetMs", attack.onsetMs);
        const gainReferenceChordSize = attack.gainReferenceChordSize ?? attack.notes.length;
        const velocity = pianoChordVelocity(gainReferenceChordSize);
        const layer = attack.layer ?? fallbackLayer;
        const sampler = graph.samplers.get(layer);
        if (!sampler) throw new Error(`No Tone sampler was prepared for ${piano.id}/${layer}.`);
        for (const rawNote of attack.notes) {
          const note = normalizedNote(rawNote);
          const offsetMs = note.offsetMs ?? 0;
          const holdMs = note.holdMs ?? attack.holdMs ?? LISTEN_BENCHMARK_DEFAULT_HOLD_MS;
          const releaseMs = note.releaseMs ?? attack.releaseMs ?? LISTEN_BENCHMARK_RELEASE_MS;
          requireFiniteNonNegative("Benchmark note offsetMs", offsetMs);
          requireFiniteNonNegative("Benchmark note holdMs", holdMs);
          requireFiniteNonNegative("Benchmark note releaseMs", releaseMs);
          if (releaseMs !== PIANO_NOTE_RELEASE_SECONDS * 1_000) {
            throw new Error(
              `The Tone renderer reuses the app's ${PIANO_NOTE_RELEASE_SECONDS * 1_000} ms ` +
              `release; received ${releaseMs} ms.`,
            );
          }
          const pitch = midiToPitchName(note.midi);
          const startsAt = (attack.onsetMs + offsetMs) / 1_000;
          sampler.triggerAttack(pitch, startsAt, velocity);
          sampler.triggerRelease(pitch, startsAt + holdMs / 1_000);
        }
      }
    }, frameCount / sampleRate, 1, sampleRate);
    const pcm = new Float32Array(rendered.getChannelData(0));
    return {
      pcm,
      renderer: { ...LISTEN_BENCHMARK_TONE_RENDERER },
      diagnostics: measureBenchmarkPcm(pcm, sampleRate),
      piano,
    };
  } finally {
    for (const graph of graphs) graph.dispose();
  }
}

/**
 * Renders with the historical direct Web Audio mixer unless a renderer is selected explicitly.
 */
export function renderBenchmarkAudio(
  options: RenderBenchmarkAudioOptions,
): Promise<ListenBenchmarkAudioRenderResult> {
  return options.renderer?.version === LISTEN_BENCHMARK_TONE_RENDERER.version
    ? renderToneBenchmarkAudio(options)
    : renderLegacyBenchmarkAudio(options);
}
