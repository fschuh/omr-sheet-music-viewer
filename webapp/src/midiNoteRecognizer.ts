import type {
  NoteRecognizer,
  NoteRecognizerCallbacks,
  RecognizedNoteEvent,
  RecognizedOnset,
  RecognizerLifecycle,
} from "./noteRecognizer";

const MIDI_SETTLE_EMIT_MS = 40;

interface MidiNoteMessage {
  channel: number;
  midi: number;
  type: "on" | "off";
  velocity: number;
}

export interface MidiNoteRecognizerEnvironment {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

function defaultEnvironment(): MidiNoteRecognizerEnvironment {
  return {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

function parseMidiNoteMessage(bytes: readonly number[]): MidiNoteMessage | null {
  if (bytes.length < 3) return null;
  const statusByte = bytes[0];
  const midi = bytes[1];
  const velocity = bytes[2];
  if (
    !Number.isInteger(statusByte) ||
    !Number.isInteger(midi) ||
    !Number.isInteger(velocity) ||
    statusByte < 0x80 ||
    statusByte > 0xef ||
    midi < 0 ||
    midi > 0x7f ||
    velocity < 0 ||
    velocity > 0x7f
  ) return null;
  const status = statusByte & 0xf0;
  if (status !== 0x80 && status !== 0x90) return null;
  return {
    channel: statusByte & 0x0f,
    midi,
    type: status === 0x80 || velocity === 0 ? "off" : "on",
    velocity,
  };
}

export function isMidiNoteMessage(bytes: readonly number[]): boolean {
  return parseMidiNoteMessage(bytes) !== null;
}

/**
 * Adapts exact MIDI note transitions to the same recognizer boundary used by
 * microphone analysis. A source key includes port and channel so releasing a
 * duplicate pitch on one keyboard does not release it on another.
 */
export class MidiNoteRecognizer implements NoteRecognizer {
  private readonly environment: MidiNoteRecognizerEnvironment;
  private callbacks: NoteRecognizerCallbacks | null = null;
  private lifecycle: RecognizerLifecycle = {
    state: "stopped",
    inputSource: "midi",
    input: "idle",
    analysis: "idle",
  };
  private generation = 0;
  private targetPitches = new Set<number>();
  private readonly heldSourcesByPitch = new Map<number, Set<string>>();
  private paused = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(environment: MidiNoteRecognizerEnvironment = defaultEnvironment()) {
    this.environment = environment;
  }

  async start(generation: number, callbacks: NoteRecognizerCallbacks): Promise<void> {
    this.stop();
    this.callbacks = callbacks;
    this.generation = generation;
    this.paused = false;
    this.lifecycle = {
      state: "listening",
      inputSource: "midi",
      input: "ready",
      analysis: "ready",
    };
    callbacks.onLifecycle(this.lifecycle);
  }

  handleMidiMessage(bytes: readonly number[], port = ""): void {
    const message = parseMidiNoteMessage(bytes);
    if (!message || this.paused || this.lifecycle.state !== "listening") return;
    const now = this.environment.now();
    const sourceKey = `${port}\u0000${message.channel}`;
    const sources = this.heldSourcesByPitch.get(message.midi) ?? new Set<string>();
    const wasActive = sources.size > 0;
    let onset: RecognizedOnset | undefined;
    let event: RecognizedNoteEvent | undefined;

    if (message.type === "on") {
      sources.add(sourceKey);
      this.heldSourcesByPitch.set(message.midi, sources);
      // MIDI already identifies the played key exactly. Velocity is expression,
      // not uncertainty, so even a pianissimo Note On is fully confident.
      const confidence = 1;
      onset = {
        midi: message.midi,
        confidence,
        noteConfidence: 1,
        onsetTimeMs: now,
      };
      event = {
        midi: message.midi,
        type: wasActive ? "reOnset" : "onset",
        confidence,
        eventTimeMs: now,
      };
      this.scheduleSettleSnapshot();
    } else {
      sources.delete(sourceKey);
      if (sources.size === 0) this.heldSourcesByPitch.delete(message.midi);
      else this.heldSourcesByPitch.set(message.midi, sources);
      if (wasActive && sources.size === 0) {
        event = {
          midi: message.midi,
          type: "offset",
          confidence: 1,
          eventTimeMs: now,
        };
      }
    }

    this.emit(now, onset ? [onset] : [], event ? [event] : []);
  }

  setTarget(targetPitches: readonly number[]): void {
    this.targetPitches = new Set(
      targetPitches.filter((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127),
    );
  }

  setGeneration(generation: number): void {
    this.generation = generation;
  }

  pause(generation: number): void {
    this.generation = generation;
    this.paused = true;
    this.clearState();
    if (this.lifecycle.state !== "stopped") this.updateLifecycle("paused");
  }

  resume(generation: number): void {
    this.generation = generation;
    this.clearState();
    this.paused = false;
    if (this.lifecycle.state !== "stopped") this.updateLifecycle("listening");
  }

  flush(): void {
    this.clearState();
  }

  stop(): void {
    this.clearState();
    this.paused = false;
    this.callbacks = null;
    this.lifecycle = {
      state: "stopped",
      inputSource: "midi",
      input: "idle",
      analysis: "idle",
    };
  }

  private updateLifecycle(state: RecognizerLifecycle["state"]): void {
    this.lifecycle = { ...this.lifecycle, state };
    this.callbacks?.onLifecycle(this.lifecycle);
  }

  private scheduleSettleSnapshot(): void {
    if (this.settleTimer !== null) this.environment.clearTimeout(this.settleTimer);
    this.settleTimer = this.environment.setTimeout(() => {
      this.settleTimer = null;
      if (!this.paused && this.lifecycle.state === "listening") {
        this.emit(this.environment.now(), [], []);
      }
    }, MIDI_SETTLE_EMIT_MS);
  }

  private emit(
    capturedAtMs: number,
    onsets: RecognizedOnset[],
    noteEvents: RecognizedNoteEvent[],
  ): void {
    const recognizedActivePitches = Array.from(this.heldSourcesByPitch.keys())
      .sort((left, right) => left - right)
      .map((midi) => ({ midi, confidence: 1 }));
    this.callbacks?.onResult({
      generation: this.generation,
      onsets,
      recognizedActivePitches,
      targetPitchEvidence: recognizedActivePitches.filter(({ midi }) => (
        this.targetPitches.has(midi)
      )),
      noteEvents,
      processingTimeMs: 0,
      capturedAtMs,
    });
  }

  private clearState(): void {
    if (this.settleTimer !== null) this.environment.clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.heldSourcesByPitch.clear();
  }
}
