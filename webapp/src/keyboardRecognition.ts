import type {
  RecognizedPitchEvidence,
  RecognizerResult,
} from "./noteRecognizer";

/**
 * online_amt can occasionally leave a pitch in its autoregressive sustain
 * state after its acoustic evidence has disappeared. This limit applies only
 * to the keyboard visualization; ExactChordMatcher still receives the
 * recognizer's unmodified output.
 */
export const KEYBOARD_STALE_SUSTAIN_MS = 1_500;

export interface KeyboardRecognitionSnapshot {
  activePitches: RecognizedPitchEvidence[];
  attacks: Array<{ midi: number; attackTimeMs: number }>;
}

export class KeyboardRecognitionTracker {
  private readonly activeSince = new Map<number, number>();
  private readonly attacks = new Map<
    number,
    { midi: number; attackTimeMs: number }
  >();
  private readonly suppressedUntilRelease = new Set<number>();
  private readonly visiblePitches = new Set<number>();

  reset(): void {
    this.activeSince.clear();
    this.attacks.clear();
    this.suppressedUntilRelease.clear();
    this.visiblePitches.clear();
  }

  suppressVisibleUntilRelease(): number[] {
    const suppressed = Array.from(this.visiblePitches)
      .sort((left, right) => left - right);
    for (const midi of suppressed) {
      this.activeSince.delete(midi);
      this.attacks.delete(midi);
      this.suppressedUntilRelease.add(midi);
    }
    this.visiblePitches.clear();
    return suppressed;
  }

  consume(result: RecognizerResult): KeyboardRecognitionSnapshot {
    const activeByPitch = new Map(
      result.recognizedActivePitches.map((pitch) => [pitch.midi, pitch]),
    );

    // Stateless recognizers already provide an acoustically refreshed active
    // snapshot. Preserve that behavior and use their onsets only for pulses.
    if (result.noteEvents === undefined) {
      this.activeSince.clear();
      for (const midi of this.suppressedUntilRelease) {
        if (!activeByPitch.has(midi)) this.suppressedUntilRelease.delete(midi);
      }
      for (const midi of this.attacks.keys()) {
        if (!activeByPitch.has(midi)) this.attacks.delete(midi);
      }
      for (const onset of result.onsets) {
        if (!activeByPitch.has(onset.midi)) continue;
        this.suppressedUntilRelease.delete(onset.midi);
        this.attacks.set(onset.midi, {
          midi: onset.midi,
          attackTimeMs: onset.onsetTimeMs,
        });
      }
      return this.remember({
        activePitches: Array.from(activeByPitch.values())
          .filter(({ midi }) => !this.suppressedUntilRelease.has(midi))
          .sort((left, right) => left.midi - right.midi),
        attacks: this.attackSnapshot(activeByPitch),
      });
    }

    for (const midi of new Set([
      ...this.activeSince.keys(),
      ...this.attacks.keys(),
      ...this.suppressedUntilRelease,
    ])) {
      if (activeByPitch.has(midi)) continue;
      this.activeSince.delete(midi);
      this.attacks.delete(midi);
      this.suppressedUntilRelease.delete(midi);
    }

    for (const event of result.noteEvents) {
      if (event.type === "offset") {
        this.activeSince.delete(event.midi);
        this.attacks.delete(event.midi);
        this.suppressedUntilRelease.delete(event.midi);
        continue;
      }
      if (!activeByPitch.has(event.midi)) continue;
      this.suppressedUntilRelease.delete(event.midi);
      this.activeSince.set(event.midi, event.eventTimeMs);
      this.attacks.set(event.midi, {
        midi: event.midi,
        attackTimeMs: event.eventTimeMs,
      });
    }

    for (const midi of activeByPitch.keys()) {
      if (
        !this.activeSince.has(midi) &&
        !this.suppressedUntilRelease.has(midi)
      ) {
        this.activeSince.set(midi, result.capturedAtMs);
      }
    }

    for (const [midi, startedAtMs] of this.activeSince) {
      if (result.capturedAtMs - startedAtMs < KEYBOARD_STALE_SUSTAIN_MS) continue;
      this.activeSince.delete(midi);
      this.attacks.delete(midi);
      this.suppressedUntilRelease.add(midi);
    }

    return this.remember(this.snapshot(activeByPitch));
  }

  private snapshot(
    activeByPitch: ReadonlyMap<number, RecognizedPitchEvidence>,
  ): KeyboardRecognitionSnapshot {
    return {
      activePitches: Array.from(this.activeSince.keys())
        .map((midi) => activeByPitch.get(midi))
        .filter((pitch): pitch is RecognizedPitchEvidence => pitch !== undefined)
        .sort((left, right) => left.midi - right.midi),
      attacks: this.attackSnapshot(activeByPitch),
    };
  }

  private attackSnapshot(
    activeByPitch: ReadonlyMap<number, RecognizedPitchEvidence>,
  ): Array<{ midi: number; attackTimeMs: number }> {
    return Array.from(this.attacks.values())
      .filter(({ midi }) => activeByPitch.has(midi))
      .sort((left, right) => left.midi - right.midi);
  }

  private remember(snapshot: KeyboardRecognitionSnapshot): KeyboardRecognitionSnapshot {
    this.visiblePitches.clear();
    for (const { midi } of snapshot.activePitches) this.visiblePitches.add(midi);
    return snapshot;
  }
}
