import * as Tone from "tone";
import { ONLINE_AMT_CHUNK_SIZE, ONLINE_AMT_SAMPLE_RATE } from "./onlineAmtProtocol";
import {
  createTonePianoGraph,
  midiToPitchName,
  PIANO_NOTE_RELEASE_SECONDS,
  pianoChordVelocity,
  pianoSampleUrls,
  type TonePianoGraph,
} from "./piano";

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
}

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
}

export interface RenderBenchmarkAudioOptions {
  attacks: readonly ListenBenchmarkAudioAttack[];
  durationMs: number;
  sampleRate?: number;
  chunkSize?: number;
  renderer?: ListenBenchmarkRendererConfiguration;
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

function nearestBundledSample(midi: number): [number, string] {
  const samples = Object.entries(pianoSampleUrls()).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => (
    Math.abs(candidate[0] - midi) < Math.abs(nearest[0] - midi) ? candidate : nearest
  ));
}

async function preparedSample(midi: number): Promise<PreparedPianoSample> {
  const [sourceMidi, url] = nearestBundledSample(midi);
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

function nearestToneBundledSample(midi: number): [number, string] {
  const samples = Object.entries(pianoSampleUrls()).map(
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

async function preparedToneSample(midi: number): Promise<PreparedPianoSample> {
  const [sourceMidi, url] = nearestToneBundledSample(midi);
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
  const prepared = new Map<number, PreparedPianoSample>();
  const notes = options.attacks.flatMap((attack) => attack.notes.map(normalizedNote));
  await Promise.all([...new Set(notes.map(({ midi }) => midi))].map(async (midi) => {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
      throw new Error(`Benchmark MIDI notes must be integers from 0 to 127, received ${midi}.`);
    }
    prepared.set(midi, await preparedSample(midi));
  }));

  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  for (const attack of options.attacks) {
    requireFiniteNonNegative("Benchmark attack onsetMs", attack.onsetMs);
    const gainReferenceChordSize = attack.gainReferenceChordSize ?? attack.notes.length;
    const chordGain = benchmarkChordGain(gainReferenceChordSize);
    for (const rawNote of attack.notes) {
      const note = normalizedNote(rawNote);
      const offsetMs = note.offsetMs ?? 0;
      const holdMs = note.holdMs ?? attack.holdMs ?? LISTEN_BENCHMARK_DEFAULT_HOLD_MS;
      const releaseMs = note.releaseMs ?? attack.releaseMs ?? LISTEN_BENCHMARK_RELEASE_MS;
      requireFiniteNonNegative("Benchmark note offsetMs", offsetMs);
      requireFiniteNonNegative("Benchmark note holdMs", holdMs);
      requireFiniteNonNegative("Benchmark note releaseMs", releaseMs);
      const sample = prepared.get(note.midi);
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
  const notes = options.attacks.flatMap((attack) => attack.notes.map(normalizedNote));
  const prepared = await Promise.all([...new Set(notes.map(({ midi }) => midi))].map(
    async (midi) => {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
        throw new Error(`Benchmark MIDI notes must be integers from 0 to 127, received ${midi}.`);
      }
      return preparedToneSample(midi);
    },
  ));
  const samples = Object.fromEntries(
    prepared.map(({ sourceMidi, buffer }) => [sourceMidi, buffer]),
  );
  const graphs: TonePianoGraph[] = [];
  try {
    const rendered = await Tone.Offline(async (context) => {
      const graph = createTonePianoGraph(context, samples);
      graphs.push(graph);
      await graph.loaded;
      for (const attack of options.attacks) {
        requireFiniteNonNegative("Benchmark attack onsetMs", attack.onsetMs);
        const gainReferenceChordSize = attack.gainReferenceChordSize ?? attack.notes.length;
        const velocity = pianoChordVelocity(gainReferenceChordSize);
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
          graph.sampler.triggerAttack(pitch, startsAt, velocity);
          graph.sampler.triggerRelease(pitch, startsAt + holdMs / 1_000);
        }
      }
    }, frameCount / sampleRate, 1, sampleRate);
    const pcm = new Float32Array(rendered.getChannelData(0));
    return {
      pcm,
      renderer: { ...LISTEN_BENCHMARK_TONE_RENDERER },
      diagnostics: measureBenchmarkPcm(pcm, sampleRate),
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
