import { useCallback, useLayoutEffect, useRef } from "react";
import type { PredictedFingering } from "../fingering";
import type { PracticeHand } from "../playback";
import { scoreOffsetToSeconds, type PerformanceRoute } from "../realtime";
import {
  HIGHWAY_LOOKAHEAD_SECONDS,
  HIGHWAY_LOOKAHEAD_STEPS,
  highwayLookaheadQuarters,
  highwayTrackForRoute,
  highwayTrackForSteps,
  highwayTrackLooped,
  type HighwayLoop,
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
 * Given `fixedTempoBpm`, the score's opening tempo, the highway runs on the route's
 * quarters instead, with a window of as many as that tempo plays in the usual
 * lookahead: notes keep their size and come down faster at a faster tempo, from the
 * tempo multiplier and the score's own tempo changes alike.
 * While one hand is practised, the other hand's notes are ghosts. A looping route
 * starts over at its end, so the highway shows its start coming again after it.
 * Notes carry their finger from `fingerings`. `timeZoom` divides the window, so
 * above 1 the highway shows less time with longer notes further apart.
 */
export function useRealtimeHighwaySource(
  getRoute: () => PerformanceRoute | null,
  getOffset: () => number,
  tempoMultiplier: number,
  hand: PracticeHand,
  getLooping: () => boolean = () => false,
  fingerings?: Readonly<Record<string, PredictedFingering>>,
  fixedTempoBpm: number | null = null,
  timeZoom = 1,
): HighwayFrameSource {
  const latest = useRef({ tempoMultiplier, hand, fingerings, fixedTempoBpm, timeZoom });
  latest.current = { tempoMultiplier, hand, fingerings, fixedTempoBpm, timeZoom };
  return useCallback(() => {
    const { fixedTempoBpm: bpm } = latest.current;
    const quarters = bpm !== null;
    const window = (quarters
      ? highwayLookaheadQuarters(bpm)
      : HIGHWAY_LOOKAHEAD_SECONDS * latest.current.tempoMultiplier) / latest.current.timeZoom;
    const route = getRoute();
    if (!route) return { track: null, now: 0, window };
    // Offsets below 0 are the lead-in counted before the route begins.
    const timeAt = (offset: number) => quarters
      ? Math.min(route.totalQuarters, offset)
      : scoreOffsetToSeconds(route, offset, 1);
    const now = timeAt(getOffset());
    const loop = getLooping() ? { start: 0, end: timeAt(route.totalQuarters) } : null;
    return {
      track: highwayTrackLooped(
        highwayTrackForRoute(
          route,
          latest.current.hand,
          latest.current.fingerings,
          quarters ? "quarters" : "seconds",
        ),
        loop,
        window,
        now < 0,
      ),
      now,
      window,
    };
  }, [getLooping, getOffset, getRoute]);
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
 * highway costs nothing. `loop`, in the same steps, is what playback repeats: past its
 * end the highway shows its start again, and stepping from its last moment back to its
 * first glides on, as if into the next bar. `timeZoom` divides the steps shown.
 */
export function useNoteByNoteHighwaySource(
  moments: readonly HighwayStepMoment[],
  currentIndex: number,
  hand: PracticeHand,
  loop: HighwayLoop | null = null,
  timeZoom = 1,
): HighwayFrameSource {
  const trackCache = useRef<{
    moments: readonly HighwayStepMoment[];
    hand: PracticeHand;
    track: HighwayTrack;
  } | null>(null);
  const latest = useRef({ moments, hand, loop, timeZoom });
  latest.current = { moments, hand, loop, timeZoom };
  const glide = useRef({ from: currentIndex, to: currentIndex, startedAt: 0, hand });

  const positionAt = useCallback((time: number) => {
    const { from, to, startedAt } = glide.current;
    const progress = Math.min(1, Math.max(0, (time - startedAt) / STEP_GLIDE_MS));
    return progress >= 1 ? to : from + (to - from) * easeOutCubic(progress);
  }, []);

  useLayoutEffect(() => {
    const time = performance.now();
    let from = positionAt(time);
    // A loop starting over: glide on from where its last moment stands before its start.
    const currentLoop = latest.current.loop;
    const previous = glide.current.to;
    if (
      currentLoop &&
      currentIndex === currentLoop.start &&
      previous >= currentLoop.end - 1 &&
      previous < currentLoop.end &&
      previous > currentIndex
    ) {
      from -= currentLoop.end - currentLoop.start;
    }
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
    const window = HIGHWAY_LOOKAHEAD_STEPS / latest.current.timeZoom;
    return {
      track: highwayTrackLooped(trackCache.current!.track, latest.current.loop, window),
      now: positionAt(performance.now()),
      window,
    };
  }, [positionAt]);
}
