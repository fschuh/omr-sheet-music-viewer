import type { RecognizedOnset, RecognizerResult } from "./noteRecognizer";

export interface ChordMatcherOptions {
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  noteThreshold: number;
  preTargetExtraLookbackMs: number;
  collectionWindowMs: number;
  settleMs: number;
  duplicateOnsetMs: number;
  wrongAttemptResetMs: number;
  refractoryMs: number;
  refractoryMode: "time" | "noteEvents";
}

export const defaultChordMatcherOptions: ChordMatcherOptions = {
  onsetThreshold: 0.5,
  targetNoteThreshold: 0.12,
  activeTargetThreshold: 0.35,
  noteThreshold: 0.6,
  preTargetExtraLookbackMs: 30,
  collectionWindowMs: 400,
  settleMs: 80,
  duplicateOnsetMs: 120,
  wrongAttemptResetMs: 180,
  refractoryMs: 180,
  refractoryMode: "time",
};

export interface ChordMatchUpdate {
  matched: boolean;
  stale: boolean;
  targetPitches: number[];
  detectedTargetPitches: number[];
  extraPitches: number[];
}

function sorted(values: Iterable<number>): number[] {
  return Array.from(values).sort((left, right) => left - right);
}

function looksLikeOvertoneAlias(extraMidi: number, targetMidi: number): boolean {
  if (extraMidi <= targetMidi) return false;
  const ratio = 2 ** ((extraMidi - targetMidi) / 12);
  const harmonic = Math.round(ratio);
  return harmonic >= 2 && harmonic <= 6 && Math.abs(ratio - harmonic) < 0.035;
}

/**
 * Collects fresh, confident onsets into an exact score chord. It intentionally
 * knows nothing about spectrum analysis, microphone capture, or playback navigation.
 */
export class ExactChordMatcher {
  private readonly options: ChordMatcherOptions;
  private generation = 0;
  private target = new Set<number>();
  private accumulated = new Map<number, RecognizedOnset>();
  private unanchoredExtras = new Map<number, RecognizedOnset>();
  private lastOnsetByPitch = new Map<number, number>();
  private attemptStartMs: number | null = null;
  private lastNewOnsetMs: number | null = null;
  private refractoryUntilMs = 0;
  private latestActivePitches = new Set<number>();
  private carryOverPitches = new Set<number>();
  private eventAttackWindows = new Map<number, {
    startedAtMs: number;
    expiresAtMs: number;
  }>();
  private rejected = false;
  private matched = false;

  constructor(options: Partial<ChordMatcherOptions> = {}) {
    this.options = { ...defaultChordMatcherOptions, ...options };
  }

  setTarget(targetPitches: readonly number[], generation: number, nowMs: number): void {
    this.generation = generation;
    this.target = new Set(targetPitches.filter((pitch) => Number.isInteger(pitch)));
    this.clearAttempt();
    this.lastOnsetByPitch.clear();
    this.eventAttackWindows.clear();
    this.carryOverPitches = this.options.refractoryMode === "noteEvents"
      ? new Set(this.latestActivePitches)
      : new Set();
    this.refractoryUntilMs = nowMs + this.options.refractoryMs;
    this.matched = false;
  }

  reset(generation: number, nowMs: number, refractory = true): void {
    this.generation = generation;
    this.clearAttempt();
    this.lastOnsetByPitch.clear();
    this.latestActivePitches.clear();
    this.carryOverPitches.clear();
    this.eventAttackWindows.clear();
    this.refractoryUntilMs = refractory ? nowMs + this.options.refractoryMs : nowMs;
    this.matched = false;
  }

  private clearAttempt(): void {
    this.accumulated.clear();
    this.unanchoredExtras.clear();
    this.attemptStartMs = null;
    this.lastNewOnsetMs = null;
    this.rejected = false;
  }

  private update(matched = false, stale = false): ChordMatchUpdate {
    const detectedTargetPitches = sorted(
      Array.from(this.accumulated.keys()).filter((pitch) => this.target.has(pitch)),
    );
    const extraPitches = sorted(
      new Set([
        ...Array.from(this.accumulated.keys()).filter((pitch) => !this.target.has(pitch)),
        ...this.unanchoredExtras.keys(),
      ]),
    );
    return {
      matched,
      stale,
      targetPitches: sorted(this.target),
      detectedTargetPitches,
      extraPitches,
    };
  }

  private eligibleOnsets(result: RecognizerResult): {
    onsets: RecognizedOnset[];
    eventBased: boolean;
  } {
    const eventBased = (
      this.options.refractoryMode === "noteEvents" &&
      result.noteEvents !== undefined
    );
    if (!eventBased) return { onsets: result.onsets, eventBased: false };

    for (const event of result.noteEvents ?? []) {
      if (event.type === "offset") {
        this.carryOverPitches.delete(event.midi);
        this.eventAttackWindows.delete(event.midi);
        continue;
      }
      this.carryOverPitches.delete(event.midi);
      this.eventAttackWindows.set(event.midi, {
        startedAtMs: event.eventTimeMs,
        expiresAtMs: event.eventTimeMs + this.options.duplicateOnsetMs,
      });
    }

    for (const [midi, window] of this.eventAttackWindows) {
      if (result.capturedAtMs > window.expiresAtMs) {
        this.eventAttackWindows.delete(midi);
      }
    }

    return {
      eventBased: true,
      onsets: result.onsets.filter((onset) => {
        const window = this.eventAttackWindows.get(onset.midi);
        return (
          window !== undefined &&
          !this.carryOverPitches.has(onset.midi) &&
          onset.onsetTimeMs >= window.startedAtMs &&
          onset.onsetTimeMs <= window.expiresAtMs
        );
      }),
    };
  }

  consume(result: RecognizerResult): ChordMatchUpdate {
    if (result.generation !== this.generation) return this.update(false, true);
    this.latestActivePitches = new Set(
      result.recognizedActivePitches.map(({ midi }) => midi),
    );
    const eligible = this.eligibleOnsets(result);
    if (this.matched || this.target.size === 0) return this.update();

    const confident = eligible.onsets
      .filter((onset) => (
        onset.confidence >= this.options.onsetThreshold &&
        onset.noteConfidence >= (
          this.target.has(onset.midi)
            ? this.options.targetNoteThreshold
            : this.options.noteThreshold
        ) &&
        (eligible.eventBased || onset.onsetTimeMs >= this.refractoryUntilMs)
      ))
      // A played upper note and the mathematically coincident partial of a
      // lower target are indistinguishable without an instrument profile.
      // Prefer the score target in that exact tie; benchmarks report these
      // cases separately from distinguishable wrong notes.
      .filter((onset) => this.target.has(onset.midi) || !Array.from(this.target)
        .some((targetMidi) => looksLikeOvertoneAlias(onset.midi, targetMidi)))
      .sort((left, right) => left.onsetTimeMs - right.onsetTimeMs || left.midi - right.midi);

    // A fresh attack after the retry interval belongs to a new attempt. Reset
    // before consuming it so notes from a previously rejected onset cannot
    // contaminate the retry, even while their piano tails remain active.
    const firstFreshOnsetMs = confident[0]?.onsetTimeMs;
    if (
      this.rejected &&
      this.lastNewOnsetMs !== null &&
      firstFreshOnsetMs !== undefined &&
      firstFreshOnsetMs - this.lastNewOnsetMs >= this.options.wrongAttemptResetMs
    ) {
      this.clearAttempt();
    }

    for (const onset of confident) {
      const previous = this.lastOnsetByPitch.get(onset.midi);
      if (previous !== undefined && onset.onsetTimeMs - previous < this.options.duplicateOnsetMs) {
        continue;
      }
      this.lastOnsetByPitch.set(onset.midi, onset.onsetTimeMs);
      if (this.attemptStartMs === null && !this.target.has(onset.midi)) {
        const existing = this.unanchoredExtras.get(onset.midi);
        if (!existing || existing.confidence < onset.confidence) {
          this.unanchoredExtras.set(onset.midi, onset);
        }
        continue;
      }
      if (this.attemptStartMs === null) {
        this.attemptStartMs = onset.onsetTimeMs;
        for (const extra of this.unanchoredExtras.values()) {
          if (
            onset.onsetTimeMs - extra.onsetTimeMs <= this.options.preTargetExtraLookbackMs
          ) {
            this.accumulated.set(extra.midi, extra);
            this.rejected = true;
          }
        }
        this.unanchoredExtras.clear();
      }
      if (onset.onsetTimeMs - this.attemptStartMs > this.options.collectionWindowMs) {
        this.rejected = true;
        continue;
      }
      const existing = this.accumulated.get(onset.midi);
      if (!existing || existing.confidence < onset.confidence) {
        this.accumulated.set(onset.midi, onset);
      }
      this.lastNewOnsetMs = Math.max(this.lastNewOnsetMs ?? 0, onset.onsetTimeMs);
      if (!this.target.has(onset.midi)) this.rejected = true;
    }

    // A chord produces one shared physical attack, but a quieter constituent
    // may not produce its own stable per-pitch onset. Once a fresh target onset
    // has anchored the attempt, allow stable target evidence to complete it.
    // This cannot start an attempt, so held notes and repeated score moments
    // still require a genuinely fresh attack.
    if (
      this.attemptStartMs !== null &&
      (eligible.eventBased || result.capturedAtMs >= this.refractoryUntilMs) &&
      result.capturedAtMs - this.attemptStartMs <= this.options.collectionWindowMs
    ) {
      for (const active of result.targetPitchEvidence) {
        const lowestTarget = this.target.size > 0 ? Math.min(...this.target) : Infinity;
        if (
          !this.target.has(active.midi) ||
          (eligible.eventBased && this.carryOverPitches.has(active.midi)) ||
          (this.target.size >= 3 && active.midi === lowestTarget) ||
          active.confidence < this.options.activeTargetThreshold ||
          this.accumulated.has(active.midi)
        ) continue;
        this.accumulated.set(active.midi, {
          midi: active.midi,
          confidence: this.options.onsetThreshold,
          noteConfidence: active.confidence,
          onsetTimeMs: result.capturedAtMs,
        });
        this.lastNewOnsetMs = Math.max(this.lastNewOnsetMs ?? 0, result.capturedAtMs);
      }
    }

    if (this.attemptStartMs !== null && result.capturedAtMs - this.attemptStartMs > this.options.collectionWindowMs) {
      const complete = Array.from(this.target).every((pitch) => this.accumulated.has(pitch));
      if (!complete) this.rejected = true;
    }

    const complete = Array.from(this.target).every((pitch) => this.accumulated.has(pitch));
    const settled = this.lastNewOnsetMs !== null &&
      result.capturedAtMs - this.lastNewOnsetMs >= this.options.settleMs;
    if (complete && settled && !this.rejected) {
      this.matched = true;
      return this.update(true);
    }

    // Target-aware recognizers may report every expected pitch so the matcher
    // can inspect sub-argmax evidence. Use confidence rather than list length
    // when an incomplete, otherwise valid attempt needs a release reset.
    const silent = result.recognizedActivePitches.every(
      (active) => active.confidence < this.options.activeTargetThreshold,
    );
    for (const [midi, onset] of this.unanchoredExtras) {
      if (
        result.capturedAtMs - onset.onsetTimeMs >=
        this.options.wrongAttemptResetMs
      ) {
        this.unanchoredExtras.delete(midi);
      }
    }
    if (
      this.lastNewOnsetMs !== null &&
      (
        (
          this.rejected &&
          (
            result.capturedAtMs - this.lastNewOnsetMs >=
              this.options.wrongAttemptResetMs ||
            (
              this.attemptStartMs !== null &&
              result.capturedAtMs - this.attemptStartMs >=
                this.options.collectionWindowMs
            )
          )
        ) ||
        (
          silent &&
          !complete &&
          result.capturedAtMs - this.lastNewOnsetMs >=
            this.options.wrongAttemptResetMs
        )
      )
    ) {
      this.clearAttempt();
    }
    return this.update();
  }
}
