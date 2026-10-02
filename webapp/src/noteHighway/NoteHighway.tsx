import { useEffect, useRef } from "react";
import { scoreOffsetToSeconds, type PerformanceRoute } from "../realtime";
import { HIGHWAY_LOOKAHEAD_SECONDS, NOTE_HIGHWAY_TOP_FRACTION } from "./highwayModel";
import { NoteHighwayRenderer } from "./highwayRenderer";
import { KeyApproachPainter } from "./keyApproachPainter";
import "./noteHighway.css";

/** Above 2x the highway costs fill rate without a visible gain. */
const MAX_PIXEL_RATIO = 2;

interface NoteHighwayProps {
  /** Read every frame, so a seek that swaps the route is drawn on the next frame. */
  getRoute: () => PerformanceRoute | null;
  /** Current route offset in quarters, read every frame from the playback clock. */
  getOffset: () => number;
  tempoMultiplier: number;
}

/**
 * Notes travel toward the keyboard and reach its top edge when they sound. The
 * layer is decorative and never takes pointer input, like the keyboard below it.
 */
export function NoteHighway({ getRoute, getOffset, tempoMultiplier }: NoteHighwayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ getRoute, getOffset, tempoMultiplier });
  latest.current = { getRoute, getOffset, tempoMultiplier };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A fresh canvas per mount: dispose() releases the WebGL context, and a
    // released context cannot be reacquired from the same canvas.
    const canvas = window.document.createElement("canvas");
    canvas.className = "note-highway-canvas";
    container.appendChild(canvas);
    let renderer: NoteHighwayRenderer | null = null;
    try {
      renderer = NoteHighwayRenderer.create(canvas);
      if (!renderer) console.warn("The 3D note highway needs WebGL2, which is unavailable.");
    } catch (error) {
      console.warn("The 3D note highway could not start.", error);
    }
    if (!renderer) {
      canvas.remove();
      return;
    }
    const active = renderer;

    const resize = () => {
      active.resize(
        canvas.clientWidth,
        canvas.clientHeight,
        Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // The keyboard is rendered beside the highway in the same workspace.
    const approachPainter = new KeyApproachPainter(container.parentElement ?? window.document);
    const approach = new Float32Array(88);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { getRoute: currentRoute, getOffset: currentOffset, tempoMultiplier: multiplier } =
        latest.current;
      const route = currentRoute();
      active.setRoute(route);
      const now = route ? scoreOffsetToSeconds(route, currentOffset(), 1) : 0;
      const windowSeconds = HIGHWAY_LOOKAHEAD_SECONDS * multiplier;
      // render() skips the GPU work and the painter skips unchanged keys, so
      // leaving the loop running while paused costs almost nothing per frame.
      active.render(now, windowSeconds);
      active.keyApproach(now, windowSeconds, approach);
      approachPainter.paint(approach);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      approachPainter.clear();
      active.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="note-highway"
      style={{ top: `${NOTE_HIGHWAY_TOP_FRACTION * 100}%` }}
      aria-hidden="true"
    />
  );
}
