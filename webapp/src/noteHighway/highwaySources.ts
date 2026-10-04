import { useCallback, useLayoutEffect, useRef } from "react";
import type { PracticeHand } from "../playback";
import { scoreOffsetToSeconds, type PerformanceRoute } from "../realtime";
import {
  HIGHWAY_LOOKAHEAD_SECONDS,
  HIGHWAY_LOOKAHEAD_STEPS,
  highwayTrackForRoute,
  highwayTrackForSteps,
  type HighwayStepMoment,
  type HighwayTrack,
} from "./highwayModel";

/** What the highway draws on one frame: a track, the time at the keys, and the visible span. */
export interface HighwayFrame {
  track: HighwayTrack | null;
  now: number;
  window: number;
}

/** Read once per animation frame by NoteHighway, outside React rendering. */
export type HighwayFrameSource = () => HighwayFrame;

/** Note-by-note advances glide the notes down rather than jumping them. */
const STEP_GLIDE_MS = 160;

/**
 * Realtime: score seconds on the playback clock. The window grows with the tempo
 * multiplier so notes take the same real time to reach the keys at any tempo.
 * While one hand is practised, the other hand's notes are ghosts.
 */
export function useRealtimeHighwaySource(
  getRoute: () => PerformanceRoute | null,
  getOffset: () => number,
  tempoMultiplier: number,
  hand: PracticeHand,
): HighwayFrameSource {
  const latest = useRef({ tempoMultiplier, hand });
  latest.current = { tempoMultiplier, hand };
  return useCallback(() => {
    const window = HIGHWAY_LOOKAHEAD_SECONDS * latest.current.tempoMultiplier;
    const route = getRoute();
    if (!route) return { track: null, now: 0, window };
    return {
      track: highwayTrackForRoute(route, latest.current.hand),
      now: scoreOffsetToSeconds(route, getOffset(), 1),
      window,
    };
  }, [getOffset, getRoute]);
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Note-by-note: one step per practised moment, positioned at the current moment
 * and gliding to the next one whenever playback advances. `moments` is the full
 * timeline, so moments the practised hand skips still show the other hand's
 * ghosts between steps; `currentIndex` indexes the practised hand's timeline.
 * The track is built on first use for each timeline and hand, so a hidden
 * highway costs nothing.
 */
export function useNoteByNoteHighwaySource(
  moments: readonly HighwayStepMoment[],
  currentIndex: number,
  hand: PracticeHand,
): HighwayFrameSource {
  const trackCache = useRef<{
    moments: readonly HighwayStepMoment[];
    hand: PracticeHand;
    track: HighwayTrack;
  } | null>(null);
  const latest = useRef({ moments, hand });
  latest.current = { moments, hand };
  const glide = useRef({ from: currentIndex, to: currentIndex, startedAt: 0, hand });

  const positionAt = useCallback((time: number) => {
    const { from, to, startedAt } = glide.current;
    const progress = Math.min(1, Math.max(0, (time - startedAt) / STEP_GLIDE_MS));
    return progress >= 1 ? to : from + (to - from) * easeOutCubic(progress);
  }, []);

  useLayoutEffect(() => {
    const time = performance.now();
    const from = positionAt(time);
    // Jumps beyond the visible span (bar, page, seek) would only smear, and a
    // hand change renumbers the steps: cut instead of gliding.
    const cut = hand !== glide.current.hand ||
      Math.abs(currentIndex - from) > HIGHWAY_LOOKAHEAD_STEPS;
    glide.current = { from: cut ? currentIndex : from, to: currentIndex, startedAt: time, hand };
  }, [currentIndex, hand, positionAt]);

  return useCallback(() => {
    const { moments: currentMoments, hand: currentHand } = latest.current;
    const cached = trackCache.current;
    if (cached?.moments !== currentMoments || cached.hand !== currentHand) {
      trackCache.current = {
        moments: currentMoments,
        hand: currentHand,
        track: highwayTrackForSteps(currentMoments, currentHand),
      };
    }
    return {
      track: trackCache.current!.track,
      now: positionAt(performance.now()),
      window: HIGHWAY_LOOKAHEAD_STEPS,
    };
  }, [positionAt]);
}
