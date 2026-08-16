import * as Tone from "tone";
import {
  DEFAULT_PIANO_ID,
  isPianoLayerFor,
  pianoDefinition,
  pianoLayerForDynamic,
  pianoSampleUrlsForLayer,
  type MusicalDynamic,
  type PianoId,
  type PianoLayerId,
} from "./pianoRegistry";

export const PIANO_NOTE_RELEASE_SECONDS = 0.35;
const AUDITION_HOLD_MS = 420;
const AUDITION_DECAY_GUARD_MS = PIANO_NOTE_RELEASE_SECONDS * 1_000 + 200;
export const PIANO_SAMPLER_ATTACK_SECONDS = 0.002;
export const PIANO_SAMPLER_VOLUME_DB = -4;
export const PIANO_LIMITER_THRESHOLD_DB = -1;
export const PIANO_COMPRESSOR_OPTIONS = Object.freeze({
  threshold: -18,
  ratio: 3,
  attack: 0.003,
  release: 0.2,
  knee: 12,
});
const WARMUP_NOTE = "C4";
const WARMUP_GAIN = 0.0001;
const WARMUP_DURATION_SECONDS = 0.02;
const WARMUP_SETTLE_MS = 100;

const NATURAL_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function pitchToMidi(pitch: string): number | null {
  const normalized = pitch.trim();
  const conventional = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(normalized);
  const trailing = /^([A-Ga-g])(-?\d+)([#b♯♭]+)$/.exec(normalized);
  const match = conventional ?? trailing;
  if (!match) return null;
  const accidentalText = conventional ? match[2] : match[3];
  const octaveText = conventional ? match[3] : match[2];
  const natural = NATURAL_SEMITONES[match[1].toUpperCase()];
  const accidental = Array.from(accidentalText).reduce((total, symbol) => (
    total + (symbol === "#" || symbol === "♯" ? 1 : -1)
  ), 0);
  const midi = (Number(octaveText) + 1) * 12 + natural + accidental;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null;
}

/** Canonical Splendid mp roots retained for existing callers and regression PCM. */
export function pianoSampleUrls(): Record<number, string> {
  return pianoSampleUrlsForLayer("splendid", "mp");
}

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function midiToPitchName(midi: number): string {
  return `${PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Per-note mix gain. Recorded acoustic velocity is selected independently by layer. */
export function pianoChordMixGain(chordSize: number): number {
  if (!Number.isInteger(chordSize) || chordSize <= 0) {
    throw new Error(`Piano chord size must be a positive integer, received ${chordSize}.`);
  }
  return Math.min(0.78, 0.9 / Math.sqrt(chordSize));
}

/** Backwards-compatible name for the canonical Tone benchmark configuration. */
export const pianoChordVelocity = pianoChordMixGain;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export interface PianoPlaybackEngine {
  load(layers?: readonly PianoLayerId[]): Promise<void>;
  activate(): Promise<void>;
  prepare(): Promise<void>;
  attack(notes: readonly string[], mixGain: number, layer: PianoLayerId): void;
  release(notes: readonly string[]): void;
  dispose(): void;
}

export interface TonePianoGraph {
  sampler: Tone.Sampler;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
  loaded: Promise<void>;
  dispose(): void;
}

export interface TonePianoLayeredGraph {
  samplers: ReadonlyMap<PianoLayerId, Tone.Sampler>;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
  loaded: Promise<void>;
  dispose(): void;
}

export type TonePianoSamples = Readonly<Record<
  number,
  string | AudioBuffer | Tone.ToneAudioBuffer
>>;

interface TonePianoOutput {
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
  dispose(): void;
}

interface TonePianoLayerSampler {
  sampler: Tone.Sampler;
  loaded: Promise<void>;
  dispose(): void;
}

function createTonePianoOutput(context: Tone.BaseContext): TonePianoOutput {
  const limiter = new Tone.Limiter({
    context,
    threshold: PIANO_LIMITER_THRESHOLD_DB,
  }).connect(context.destination);
  const compressor = new Tone.Compressor({
    context,
    ...PIANO_COMPRESSOR_OPTIONS,
  }).connect(limiter);
  return {
    compressor,
    limiter,
    dispose: () => {
      compressor.dispose();
      limiter.dispose();
    },
  };
}

function createTonePianoLayerSampler(
  context: Tone.BaseContext,
  samples: TonePianoSamples,
  destination: Tone.InputNode,
  volumeDb = PIANO_SAMPLER_VOLUME_DB,
): TonePianoLayerSampler {
  let resolveLoaded!: () => void;
  let rejectLoaded!: (error: unknown) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
  });
  const sampler = new Tone.Sampler({
    context,
    urls: { ...samples },
    attack: PIANO_SAMPLER_ATTACK_SECONDS,
    release: PIANO_NOTE_RELEASE_SECONDS,
    curve: "exponential",
    volume: volumeDb,
    onload: resolveLoaded,
    onerror: rejectLoaded,
  }).connect(destination);
  return { sampler, loaded, dispose: () => sampler.dispose() };
}

/** Builds the graph shared by canonical realtime playback and offline rendering. */
export function createTonePianoGraph(
  context: Tone.BaseContext = Tone.getContext(),
  samples: TonePianoSamples = pianoSampleUrls(),
): TonePianoGraph {
  const output = createTonePianoOutput(context);
  const layer = createTonePianoLayerSampler(context, samples, output.compressor);
  return {
    sampler: layer.sampler,
    compressor: output.compressor,
    limiter: output.limiter,
    loaded: layer.loaded,
    dispose: () => {
      layer.dispose();
      output.dispose();
    },
  };
}

/** Builds multiple acoustic layers over one shared compressor and limiter. */
export function createTonePianoLayeredGraph(
  context: Tone.BaseContext,
  samplesByLayer: ReadonlyMap<PianoLayerId, TonePianoSamples>,
  volumeDb = PIANO_SAMPLER_VOLUME_DB,
): TonePianoLayeredGraph {
  const output = createTonePianoOutput(context);
  const layers = new Map([...samplesByLayer].map(([layer, samples]) => [
    layer,
    createTonePianoLayerSampler(context, samples, output.compressor, volumeDb),
  ]));
  return {
    samplers: new Map([...layers].map(([layer, prepared]) => [layer, prepared.sampler])),
    compressor: output.compressor,
    limiter: output.limiter,
    loaded: Promise.all([...layers.values()].map(({ loaded }) => loaded)).then(() => undefined),
    dispose: () => {
      for (const layer of layers.values()) layer.dispose();
      output.dispose();
    },
  };
}

class TonePianoPlaybackEngine implements PianoPlaybackEngine {
  private readonly context = Tone.getContext();
  private readonly output = createTonePianoOutput(this.context);
  private readonly samplers = new Map<PianoLayerId, TonePianoLayerSampler>();
  private readonly activeLayerByNote = new Map<string, PianoLayerId>();
  private activation: Promise<void> | null = null;
  private preparation: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly pianoId: PianoId) {}

  private layerSampler(layer: PianoLayerId): TonePianoLayerSampler {
    if (this.disposed) throw new Error("The piano playback engine has been disposed.");
    if (!isPianoLayerFor(this.pianoId, layer)) {
      throw new Error(`Piano layer ${layer} does not belong to ${this.pianoId}.`);
    }
    let result = this.samplers.get(layer);
    if (!result) {
      result = createTonePianoLayerSampler(
        this.context,
        pianoSampleUrlsForLayer(this.pianoId, layer),
        this.output.compressor,
        pianoDefinition(this.pianoId).samplerVolumeDb,
      );
      this.samplers.set(layer, result);
    }
    return result;
  }

  async load(layers: readonly PianoLayerId[] = [pianoDefinition(this.pianoId).defaultLayer]): Promise<void> {
    await Promise.all(layers.map((layer) => this.layerSampler(layer).loaded));
  }

  activate(): Promise<void> {
    if (!this.activation) {
      this.activation = Tone.start().catch((error: unknown) => {
        this.activation = null;
        throw error;
      });
    }
    return this.activation;
  }

  private async ready(): Promise<void> {
    await Promise.all([this.activate(), this.load()]);
  }

  prepare(): Promise<void> {
    if (!this.preparation) {
      this.preparation = this.ready()
        .then(async () => {
          const layer = pianoDefinition(this.pianoId).defaultLayer;
          const sampler = this.layerSampler(layer).sampler;
          const startTime = Tone.immediate() + 0.008;
          sampler.triggerAttack(WARMUP_NOTE, startTime, WARMUP_GAIN);
          sampler.triggerRelease(WARMUP_NOTE, startTime + WARMUP_DURATION_SECONDS);
          await wait(WARMUP_SETTLE_MS);
        })
        .catch((error: unknown) => {
          this.preparation = null;
          throw error;
        });
    }
    return this.preparation;
  }

  attack(notes: readonly string[], mixGain: number, layer: PianoLayerId): void {
    for (const note of notes) this.activeLayerByNote.set(note, layer);
    const prepared = this.layerSampler(layer);
    void prepared.loaded
      .then(() => {
        if (this.disposed) return;
        const stillRequested = notes.filter((note) => this.activeLayerByNote.get(note) === layer);
        if (stillRequested.length > 0) {
          prepared.sampler.triggerAttack(stillRequested, Tone.immediate() + 0.008, mixGain);
        }
      })
      // Interactive callers preload their required layers so failures reach the
      // existing playback-error UI. Keep this defensive handler for attacks
      // issued by lower-level realtime callers during teardown races.
      .catch(() => undefined);
  }

  release(notes: readonly string[]): void {
    const byLayer = new Map<PianoLayerId, string[]>();
    for (const note of notes) {
      const layer = this.activeLayerByNote.get(note);
      if (!layer) continue;
      const selected = byLayer.get(layer) ?? [];
      selected.push(note);
      byLayer.set(layer, selected);
      this.activeLayerByNote.delete(note);
    }
    const now = Tone.immediate();
    for (const [layer, selected] of byLayer) {
      this.samplers.get(layer)?.sampler.triggerRelease(selected, now);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.release([...this.activeLayerByNote.keys()]);
    this.disposed = true;
    for (const layer of this.samplers.values()) layer.dispose();
    this.samplers.clear();
    this.output.dispose();
  }
}

function requestedLayer(
  pianoId: PianoId,
  dynamicOrLayer: MusicalDynamic | PianoLayerId,
): PianoLayerId {
  return isPianoLayerFor(pianoId, dynamicOrLayer)
    ? dynamicOrLayer
    : pianoLayerForDynamic(pianoId, dynamicOrLayer as MusicalDynamic);
}

export class PianoSampler {
  private engine: PianoPlaybackEngine | null = null;
  private preparation: Promise<void> | null = null;
  private activeNotes: string[] = [];
  private playGeneration = 0;

  constructor(
    private readonly createEngine: (pianoId: PianoId) => PianoPlaybackEngine = (
      pianoId,
    ) => new TonePianoPlaybackEngine(pianoId),
    private pianoId: PianoId = DEFAULT_PIANO_ID,
  ) {}

  selectedPiano(): PianoId {
    return this.pianoId;
  }

  private audioEngine(): PianoPlaybackEngine {
    if (!this.engine) this.engine = this.createEngine(this.pianoId);
    return this.engine;
  }

  preload(layers?: readonly PianoLayerId[]): Promise<void> {
    return this.audioEngine().load(layers);
  }

  activate(): Promise<void> {
    return this.audioEngine().activate();
  }

  prepare(): Promise<void> {
    if (!this.preparation) {
      this.preparation = this.audioEngine().prepare().catch((error: unknown) => {
        this.preparation = null;
        throw error;
      });
    }
    return this.preparation;
  }

  async setPiano(pianoId: PianoId): Promise<void> {
    if (pianoId === this.pianoId) return this.prepare();
    this.stop();
    this.engine?.dispose();
    this.engine = null;
    this.preparation = null;
    this.pianoId = pianoId;
    await this.prepare();
  }

  /** Current Tone audio-context time used by realtime score scheduling. */
  now(): number {
    return Tone.immediate();
  }

  stop(): void {
    this.playGeneration += 1;
    if (this.engine) this.engine.release(this.activeNotes);
    this.activeNotes = [];
  }

  dispose(): void {
    this.stop();
    this.engine?.dispose();
    this.engine = null;
    this.preparation = null;
  }

  async play(
    pitches: readonly string[],
    dynamicOrLayer: MusicalDynamic | PianoLayerId = "mp",
  ): Promise<void> {
    const midiNotes = Array.from(new Set(
      pitches.flatMap((pitch) => {
        const midi = pitchToMidi(pitch);
        return midi === null ? [] : [midi];
      }),
    ));
    const generation = ++this.playGeneration;
    if (this.engine) this.engine.release(this.activeNotes);
    this.activeNotes = [];
    if (midiNotes.length === 0) return;

    const layer = requestedLayer(this.pianoId, dynamicOrLayer);
    await Promise.all([
      this.prepare(),
      layer === pianoDefinition(this.pianoId).defaultLayer
        ? Promise.resolve()
        : this.preload([layer]),
    ]);
    if (generation !== this.playGeneration) return;

    const notes = midiNotes.map(midiToPitchName);
    this.audioEngine().attack(
      notes,
      pianoChordMixGain(notes.length),
      layer,
    );
    this.activeNotes = notes;
  }

  /** Attack additional notes without releasing sustained realtime notes. */
  attack(
    pitches: readonly string[],
    dynamicOrLayer: MusicalDynamic | PianoLayerId = "mp",
  ): void {
    const notes = Array.from(new Set(pitches.flatMap((pitch) => {
      const midi = pitchToMidi(pitch);
      return midi === null ? [] : [midiToPitchName(midi)];
    })));
    const newNotes = notes.filter((note) => !this.activeNotes.includes(note));
    if (newNotes.length === 0) return;
    this.audioEngine().attack(
      newNotes,
      pianoChordMixGain(newNotes.length),
      requestedLayer(this.pianoId, dynamicOrLayer),
    );
    this.activeNotes = Array.from(new Set([...this.activeNotes, ...newNotes]));
  }

  /** Release only the requested notes, preserving other realtime sustains. */
  release(pitches: readonly string[]): void {
    if (!this.engine) return;
    const notes = Array.from(new Set(pitches.flatMap((pitch) => {
      const midi = pitchToMidi(pitch);
      return midi === null ? [] : [midiToPitchName(midi)];
    })));
    const active = notes.filter((note) => this.activeNotes.includes(note));
    if (active.length === 0) return;
    this.engine.release(active);
    const released = new Set(active);
    this.activeNotes = this.activeNotes.filter((note) => !released.has(note));
  }

  async audition(
    pitches: readonly string[],
    timing: { holdMs?: number; decayGuardMs?: number } = {},
    dynamicOrLayer: MusicalDynamic | PianoLayerId = "mp",
  ): Promise<void> {
    const midiNotes = Array.from(new Set(
      pitches.flatMap((pitch) => {
        const midi = pitchToMidi(pitch);
        return midi === null ? [] : [midi];
      }),
    ));
    const generation = ++this.playGeneration;
    if (this.engine) this.engine.release(this.activeNotes);
    this.activeNotes = [];
    if (midiNotes.length === 0) return;

    const layer = requestedLayer(this.pianoId, dynamicOrLayer);
    await Promise.all([
      this.prepare(),
      layer === pianoDefinition(this.pianoId).defaultLayer
        ? Promise.resolve()
        : this.preload([layer]),
    ]);
    if (generation !== this.playGeneration) return;
    const engine = this.audioEngine();
    const notes = midiNotes.map(midiToPitchName);
    engine.attack(
      notes,
      pianoChordMixGain(notes.length),
      layer,
    );
    this.activeNotes = notes;
    await wait(timing.holdMs ?? AUDITION_HOLD_MS);
    if (generation !== this.playGeneration) return;
    engine.release(notes);
    this.activeNotes = [];
    await wait(timing.decayGuardMs ?? AUDITION_DECAY_GUARD_MS);
  }
}

export const pianoSampler = new PianoSampler();
