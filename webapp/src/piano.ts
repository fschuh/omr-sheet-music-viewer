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

const NOTE_RELEASE_SECONDS = 0.35;
const SAMPLER_VOLUME_DB = -4;
const LIMITER_THRESHOLD_DB = -1;

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

function tonePitchForMidi(midi: number): string {
  return `${PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface PianoPlaybackEngine {
  ready(): Promise<void>;
  attack(notes: readonly string[], velocity: number): void;
  release(notes: readonly string[]): void;
}

class TonePianoPlaybackEngine implements PianoPlaybackEngine {
  private readonly sampler: Tone.Sampler;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly loaded: Promise<void>;

  constructor() {
    let resolveLoaded!: () => void;
    let rejectLoaded!: (error: unknown) => void;
    this.loaded = new Promise<void>((resolve, reject) => {
      resolveLoaded = resolve;
      rejectLoaded = reject;
    });
    this.limiter = new Tone.Limiter(LIMITER_THRESHOLD_DB).toDestination();
    this.compressor = new Tone.Compressor({
      threshold: -18,
      ratio: 3,
      attack: 0.003,
      release: 0.2,
      knee: 12,
    }).connect(this.limiter);
    this.sampler = new Tone.Sampler({
      urls: pianoSampleUrls(),
      attack: 0.008,
      release: NOTE_RELEASE_SECONDS,
      curve: "exponential",
      volume: SAMPLER_VOLUME_DB,
      onload: resolveLoaded,
      onerror: rejectLoaded,
    }).connect(this.compressor);
  }

  async ready(): Promise<void> {
    await Tone.start();
    await this.loaded;
  }

  attack(notes: readonly string[], velocity: number): void {
    this.sampler.triggerAttack([...notes], Tone.immediate() + 0.008, velocity);
  }

  release(notes: readonly string[]): void {
    if (notes.length > 0) this.sampler.triggerRelease([...notes], Tone.immediate());
  }
}

export class PianoSampler {
  private engine: PianoPlaybackEngine | null = null;
  private activeNotes: string[] = [];
  private playGeneration = 0;

  constructor(
    private readonly createEngine: () => PianoPlaybackEngine = () => new TonePianoPlaybackEngine(),
  ) {}

  private audioEngine(): PianoPlaybackEngine {
    if (!this.engine) this.engine = this.createEngine();
    return this.engine;
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

    const engine = this.audioEngine();
    await engine.ready();
    if (generation !== this.playGeneration) return;

    const notes = midiNotes.map(tonePitchForMidi);
    const velocity = Math.min(0.78, 0.9 / Math.sqrt(notes.length));
    engine.attack(notes, velocity);
    this.activeNotes = notes;
  }
}

export const pianoSampler = new PianoSampler();
