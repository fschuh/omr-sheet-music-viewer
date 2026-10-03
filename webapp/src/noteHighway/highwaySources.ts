import { useCallback, useLayoutEffect, useRef } from "react";
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
 */
export function useRealtimeHighwaySource(
  getRoute: () => PerformanceRoute | null,
  getOffset: () => number,
  tempoMultiplier: number,
): HighwayFrameSource {
  const multiplier = useRef(tempoMultiplier);
  multiplier.current = tempoMultiplier;
  return useCallback(() => {
    const window = HIGHWAY_LOOKAHEAD_SECONDS * multiplier.current;
    const route = getRoute();
    if (!route) return { track: null, now: 0, window };
    return {
      track: highwayTrackForRoute(route),
      now: scoreOffsetToSeconds(route, getOffset(), 1),
      window,
    };
  }, [getOffset, getRoute]);
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Note-by-note: one step per moment, positioned at the current moment and gliding
 * to the next one whenever playback advances. The track is built on first use
 * for each timeline, so a hidden highway costs nothing.
 */
export function useNoteByNoteHighwaySource(
  moments: readonly HighwayStepMoment[],
  currentIndex: number,
): HighwayFrameSource {
  const trackCache = useRef<{ moments: readonly HighwayStepMoment[]; track: HighwayTrack } | null>(null);
  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  const glide = useRef({ from: currentIndex, to: currentIndex, startedAt: 0 });

  const positionAt = useCallback((time: number) => {
    const { from, to, startedAt } = glide.current;
    const progress = Math.min(1, Math.max(0, (time - startedAt) / STEP_GLIDE_MS));
    return progress >= 1 ? to : from + (to - from) * easeOutCubic(progress);
  }, []);

  useLayoutEffect(() => {
    const time = performance.now();
    const from = positionAt(time);
    // Jumps beyond the visible span (bar, page, seek) would only smear: cut instead.
    const far = Math.abs(currentIndex - from) > HIGHWAY_LOOKAHEAD_STEPS;
    glide.current = { from: far ? currentIndex : from, to: currentIndex, startedAt: time };
  }, [currentIndex, positionAt]);

  return useCallback(() => {
    const current = momentsRef.current;
    if (trackCache.current?.moments !== current) {
      trackCache.current = { moments: current, track: highwayTrackForSteps(current) };
    }
    return {
      track: trackCache.current.track,
      now: positionAt(performance.now()),
      window: HIGHWAY_LOOKAHEAD_STEPS,
    };
  }, [positionAt]);
}
