import type { RecognizerResult } from "@fschuh/piano-transcription-engine";

/**
 * Matches a chord from exact key state, as MIDI reports it: every target note is held
 * down, each pressed since the target was set, and no other key pressed since then is
 * still down. Unlike ExactChordMatcher, which is built for what a microphone hears,
 * the notes need not arrive together: a chord gathered a hand at a time, or held once
 * a stray key has been let go, still counts. Keys already down when the target is set
 * must be pressed again. It matches once per target, and only `settleMs` after the
 * last key went down, so a chord still being built is not taken for its first notes.
 */
export class HeldChordMatcher {
  private readonly settleMs: number;
  private target = new Set<number>();
  /** Keys pressed since the target was set and not released since. */
  private readonly pressed = new Set<number>();
  private lastPressMs = -Infinity;
  private matched = false;

  constructor(settleMs: number) {
    this.settleMs = settleMs;
  }

  setTarget(target: readonly number[]): void {
    this.target = new Set(target);
    this.pressed.clear();
    this.lastPressMs = -Infinity;
    this.matched = false;
  }

  /** Whether `result` completes the target; true at most once per target. */
  consume(result: RecognizerResult): boolean {
    for (const event of result.noteEvents ?? []) {
      if (event.type === "offset") {
        this.pressed.delete(event.midi);
      } else {
        this.pressed.add(event.midi);
        this.lastPressMs = Math.max(this.lastPressMs, event.eventTimeMs);
      }
    }
    const held = new Set(result.recognizedActivePitches.map(({ midi }) => midi));
    for (const midi of this.pressed) {
      if (!held.has(midi)) this.pressed.delete(midi);
    }
    if (this.matched || this.target.size === 0) return false;
    const complete = [...this.target].every((midi) => this.pressed.has(midi));
    const clean = [...this.pressed].every((midi) => this.target.has(midi));
    const settled = result.capturedAtMs - this.lastPressMs >= this.settleMs;
    if (!complete || !clean || !settled) return false;
    this.matched = true;
    return true;
  }
}
