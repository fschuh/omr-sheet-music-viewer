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

interface PianoSample {
  file: string;
  midi: number;
}

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

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

const PIANO_SAMPLES: PianoSample[] = SAMPLE_FILES
  .map((file): PianoSample => {
    const labelledMidi = pitchToMidi(file.slice(3).replace("s", "#"));
    if (labelledMidi === null) throw new Error(`Invalid bundled piano sample name: ${file}`);
    // This sample set labels each recording one octave below its concert pitch.
    return { file, midi: labelledMidi + 12 };
  })
  .sort((first, second) => first.midi - second.midi);

export function nearestPianoSample(midi: number): PianoSample {
  return PIANO_SAMPLES.reduce((nearest, candidate) =>
    Math.abs(candidate.midi - midi) < Math.abs(nearest.midi - midi) ? candidate : nearest,
  );
}

export class PianoSampler {
  private context: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voices = new Set<ActiveVoice>();
  private playGeneration = 0;

  constructor(
    private readonly createContext: () => AudioContext = () => new AudioContext(),
    private readonly fetchAsset: typeof fetch = (...arguments_) => fetch(...arguments_),
  ) {}

  private audioContext(): AudioContext {
    if (!this.context) this.context = this.createContext();
    return this.context;
  }

  private sampleUrl(file: string): string {
    return `/audio/piano/${encodeURIComponent(file)}.ogg`;
  }

  private loadSample(context: AudioContext, sample: PianoSample): Promise<AudioBuffer> {
    const cached = this.buffers.get(sample.file);
    if (cached) return cached;
    const loading = this.fetchAsset(this.sampleUrl(sample.file))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load piano sample ${sample.file}: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch((error) => {
        this.buffers.delete(sample.file);
        throw error;
      });
    this.buffers.set(sample.file, loading);
    return loading;
  }

  private releaseVoices(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.06);
      voice.source.stop(now + 0.07);
    }
    this.voices.clear();
  }

  stop(): void {
    this.playGeneration += 1;
    this.releaseVoices();
  }

  async play(pitches: readonly string[]): Promise<void> {
    const midiNotes = Array.from(new Set(
      pitches.flatMap((pitch) => {
        const midi = pitchToMidi(pitch);
        return midi === null ? [] : [midi];
      }),
    ));
    const generation = ++this.playGeneration;
    this.releaseVoices();
    if (midiNotes.length === 0) return;

    const context = this.audioContext();
    if (context.state === "suspended") await context.resume();
    const selected = midiNotes.map((midi) => ({ midi, sample: nearestPianoSample(midi) }));
    const loadedBuffers = await Promise.allSettled(
      selected.map(({ sample }) => this.loadSample(context, sample)),
    );
    if (generation !== this.playGeneration) return;

    const playable = selected.flatMap((selection, index) => {
      const loaded = loadedBuffers[index];
      return loaded.status === "fulfilled"
        ? [{ ...selection, buffer: loaded.value }]
        : [];
    });
    const firstFailure = loadedBuffers.find((loaded) => loaded.status === "rejected");
    if (playable.length === 0 && firstFailure?.status === "rejected") throw firstFailure.reason;

    const when = context.currentTime + 0.008;
    const voiceGain = Math.min(0.78, 0.9 / Math.sqrt(playable.length));
    playable.forEach(({ midi, sample, buffer }) => {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const voice = { source, gain };
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(2 ** ((midi - sample.midi) / 12), when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(voiceGain, when + 0.008);
      source.connect(gain).connect(context.destination);
      source.onended = () => this.voices.delete(voice);
      this.voices.add(voice);
      source.start(when);
    });
    if (firstFailure?.status === "rejected") throw firstFailure.reason;
  }
}

export const pianoSampler = new PianoSampler();
