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
  wrongAttemptSilenceMs: number;
  refractoryMs: number;
}

export const defaultChordMatcherOptions: ChordMatcherOptions = {
  onsetThreshold: 0.5,
  targetNoteThreshold: 0.3,
  activeTargetThreshold: 0.35,
  noteThreshold: 0.6,
  preTargetExtraLookbackMs: 30,
  collectionWindowMs: 400,
  settleMs: 80,
  duplicateOnsetMs: 120,
  wrongAttemptSilenceMs: 180,
  refractoryMs: 180,
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
  private lastUnanchoredOnsetMs: number | null = null;
  private refractoryUntilMs = 0;
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
    this.refractoryUntilMs = nowMs + this.options.refractoryMs;
    this.matched = false;
  }

  reset(generation: number, nowMs: number, refractory = true): void {
    this.generation = generation;
    this.clearAttempt();
    this.lastOnsetByPitch.clear();
    this.refractoryUntilMs = refractory ? nowMs + this.options.refractoryMs : nowMs;
    this.matched = false;
  }

  private clearAttempt(): void {
    this.accumulated.clear();
    this.unanchoredExtras.clear();
    this.attemptStartMs = null;
    this.lastNewOnsetMs = null;
    this.lastUnanchoredOnsetMs = null;
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

  consume(result: RecognizerResult): ChordMatchUpdate {
    if (result.generation !== this.generation) return this.update(false, true);
    if (this.matched || this.target.size === 0) return this.update();

    const confident = result.onsets
      .filter((onset) => (
        onset.confidence >= this.options.onsetThreshold &&
        onset.noteConfidence >= (
          this.target.has(onset.midi)
            ? this.options.targetNoteThreshold
            : this.options.noteThreshold
        ) &&
        onset.onsetTimeMs >= this.refractoryUntilMs
      ))
      .sort((left, right) => left.onsetTimeMs - right.onsetTimeMs || left.midi - right.midi);

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
        this.lastUnanchoredOnsetMs = Math.max(
          this.lastUnanchoredOnsetMs ?? 0,
          onset.onsetTimeMs,
        );
        continue;
      }
      if (this.attemptStartMs === null) {
        this.attemptStartMs = onset.onsetTimeMs;
        for (const extra of this.unanchoredExtras.values()) {
          if (
            onset.onsetTimeMs - extra.onsetTimeMs <= this.options.preTargetExtraLookbackMs ||
            !looksLikeOvertoneAlias(extra.midi, onset.midi)
          ) {
            this.accumulated.set(extra.midi, extra);
            this.rejected = true;
          }
        }
        this.unanchoredExtras.clear();
        this.lastUnanchoredOnsetMs = null;
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
      result.capturedAtMs >= this.refractoryUntilMs &&
      result.capturedAtMs - this.attemptStartMs <= this.options.collectionWindowMs
    ) {
      for (const active of result.activePitches) {
        if (
          !this.target.has(active.midi) ||
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

    const silent = result.activePitches.length === 0;
    if (
      silent &&
      this.lastUnanchoredOnsetMs !== null &&
      result.capturedAtMs - this.lastUnanchoredOnsetMs >= this.options.wrongAttemptSilenceMs
    ) {
      this.unanchoredExtras.clear();
      this.lastUnanchoredOnsetMs = null;
    }
    if (
      silent &&
      this.lastNewOnsetMs !== null &&
      result.capturedAtMs - this.lastNewOnsetMs >= this.options.wrongAttemptSilenceMs &&
      (this.rejected || !complete)
    ) {
      this.clearAttempt();
    }
    return this.update();
  }
}
