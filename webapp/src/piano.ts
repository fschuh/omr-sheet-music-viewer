import * as Tone from "tone";

const SAMPLE_FILES = [
  "Mp-B-1", "Mp-Ds0", "Mp-F0", "Mp-G0", "Mp-A0", "Mp-B0", "Mp-Cs1", "Mp-D1",
  "Mp-E1", "Mp-F1", "Mp-G1", "Mp-A1", "Mp-B1", "Mp-C2", "Mp-D2", "Mp-E2",
  "Mp-F2", "Mp-G2", "Mp-Gs2", "Mp-A2", "Mp-As2", "Mp-B2", "Mp-C3", "Mp-D3",
  "Mp-E3", "Mp-F3", "Mp-G3", "Mp-A3", "Mp-B3", "Mp-C4", "Mp-D4", "Mp-E4",
  "Mp-F4", "Mp-G4", "Mp-Gs4", "Mp-A4", "Mp-As4", "Mp-B4", "Mp-Cs5", "Mp-D5",
  "Mp-Ds5", "Mp-E5", "Mp-F5", "Mp-Fs5", "Mp-G5", "Mp-Gs5", "Mp-A5", "Mp-As5",
  "Mp-B5", "Mp-C6", "Mp-Cs6", "Mp-D6", "Mp-Ds6", "Mp-F6", "Mp-Fs6", "Mp-G6",
  "Mp-Gs6", "Mp-A6", "Mp-As6",
] as const;

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
const WARMUP_VELOCITY = 0.0001;
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

const PIANO_SAMPLE_URLS: Readonly<Record<number, string>> = Object.fromEntries(
  SAMPLE_FILES.map((file): [number, string] => {
    const labelledMidi = pitchToMidi(file.slice(3).replace("s", "#"));
    if (labelledMidi === null) throw new Error(`Invalid bundled piano sample name: ${file}`);
    // This sample set labels each recording one octave below its concert pitch.
    return [labelledMidi + 12, `/audio/piano/${encodeURIComponent(file)}.ogg`];
  }),
);

export function pianoSampleUrls(): Record<number, string> {
  return { ...PIANO_SAMPLE_URLS };
}

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function midiToPitchName(midi: number): string {
  return `${PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function pianoChordVelocity(chordSize: number): number {
  if (!Number.isInteger(chordSize) || chordSize <= 0) {
    throw new Error(`Piano chord size must be a positive integer, received ${chordSize}.`);
  }
  return Math.min(0.78, 0.9 / Math.sqrt(chordSize));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export interface PianoPlaybackEngine {
  load(): Promise<void>;
  activate(): Promise<void>;
  prepare(): Promise<void>;
  attack(notes: readonly string[], velocity: number): void;
  release(notes: readonly string[]): void;
}

export interface TonePianoGraph {
  sampler: Tone.Sampler;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
  loaded: Promise<void>;
  dispose(): void;
}

export type TonePianoSamples = Readonly<Record<
  number,
  string | AudioBuffer | Tone.ToneAudioBuffer
>>;

/** Builds the graph shared by realtime playback and offline benchmark rendering. */
export function createTonePianoGraph(
  context: Tone.BaseContext = Tone.getContext(),
  samples: TonePianoSamples = pianoSampleUrls(),
): TonePianoGraph {
  let resolveLoaded!: () => void;
  let rejectLoaded!: (error: unknown) => void;
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
  });
  const limiter = new Tone.Limiter({
    context,
    threshold: PIANO_LIMITER_THRESHOLD_DB,
  }).connect(context.destination);
  const compressor = new Tone.Compressor({
    context,
    ...PIANO_COMPRESSOR_OPTIONS,
  }).connect(limiter);
  const sampler = new Tone.Sampler({
    context,
    urls: { ...samples },
    attack: PIANO_SAMPLER_ATTACK_SECONDS,
    release: PIANO_NOTE_RELEASE_SECONDS,
    curve: "exponential",
    volume: PIANO_SAMPLER_VOLUME_DB,
    onload: resolveLoaded,
    onerror: rejectLoaded,
  }).connect(compressor);
  return {
    sampler,
    compressor,
    limiter,
    loaded,
    dispose: () => {
      sampler.dispose();
      compressor.dispose();
      limiter.dispose();
    },
  };
}

class TonePianoPlaybackEngine implements PianoPlaybackEngine {
  private readonly graph: TonePianoGraph;
  private activation: Promise<void> | null = null;
  private preparation: Promise<void> | null = null;

  constructor() {
    this.graph = createTonePianoGraph();
  }

  async load(): Promise<void> {
    await this.graph.loaded;
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
          const startTime = Tone.immediate() + 0.008;
          this.graph.sampler.triggerAttack(WARMUP_NOTE, startTime, WARMUP_VELOCITY);
          this.graph.sampler.triggerRelease(WARMUP_NOTE, startTime + WARMUP_DURATION_SECONDS);
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, WARMUP_SETTLE_MS));
        })
        .catch((error: unknown) => {
          this.preparation = null;
          throw error;
        });
    }
    return this.preparation;
  }

  attack(notes: readonly string[], velocity: number): void {
    this.graph.sampler.triggerAttack([...notes], Tone.immediate() + 0.008, velocity);
  }

  release(notes: readonly string[]): void {
    if (notes.length > 0) this.graph.sampler.triggerRelease([...notes], Tone.immediate());
  }
}

export class PianoSampler {
  private engine: PianoPlaybackEngine | null = null;
  private preparation: Promise<void> | null = null;
  private activeNotes: string[] = [];
  private playGeneration = 0;

  constructor(
    private readonly createEngine: () => PianoPlaybackEngine = () => new TonePianoPlaybackEngine(),
  ) {}

  private audioEngine(): PianoPlaybackEngine {
    if (!this.engine) this.engine = this.createEngine();
    return this.engine;
  }

  preload(): Promise<void> {
    return this.audioEngine().load();
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

  /** Current Tone audio-context time used by realtime score scheduling. */
  now(): number {
    return Tone.immediate();
  }

  stop(): void {
    this.playGeneration += 1;
    if (this.engine) this.engine.release(this.activeNotes);
    this.activeNotes = [];
  }

  async play(pitches: readonly string[]): Promise<void> {
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

    await this.prepare();
    if (generation !== this.playGeneration) return;

    const notes = midiNotes.map(midiToPitchName);
    const velocity = pianoChordVelocity(notes.length);
    this.audioEngine().attack(notes, velocity);
    this.activeNotes = notes;
  }

  /** Attack additional notes without releasing sustained realtime notes. */
  attack(pitches: readonly string[]): void {
    const notes = Array.from(new Set(pitches.flatMap((pitch) => {
      const midi = pitchToMidi(pitch);
      return midi === null ? [] : [midiToPitchName(midi)];
    })));
    const newNotes = notes.filter((note) => !this.activeNotes.includes(note));
    if (newNotes.length === 0) return;
    const velocity = pianoChordVelocity(newNotes.length);
    this.audioEngine().attack(newNotes, velocity);
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

    await this.prepare();
    if (generation !== this.playGeneration) return;
    const engine = this.audioEngine();
    const notes = midiNotes.map(midiToPitchName);
    engine.attack(notes, pianoChordVelocity(notes.length));
    this.activeNotes = notes;
    await wait(timing.holdMs ?? AUDITION_HOLD_MS);
    if (generation !== this.playGeneration) return;
    engine.release(notes);
    this.activeNotes = [];
    await wait(timing.decayGuardMs ?? AUDITION_DECAY_GUARD_MS);
  }
}

export const pianoSampler = new PianoSampler();
