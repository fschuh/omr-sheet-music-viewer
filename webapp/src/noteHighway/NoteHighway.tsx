import { useEffect, useRef } from "react";
import { NOTE_HIGHWAY_TOP_FRACTION } from "./highwayModel";
import { NoteHighwayRenderer } from "./highwayRenderer";
import type { HighwayFrameSource } from "./highwaySources";
import { KeyApproachPainter } from "./keyApproachPainter";
import "./noteHighway.css";

/** Above 2x the highway costs fill rate without a visible gain. */
const MAX_PIXEL_RATIO = 2;

interface NoteHighwayProps {
  /**
   * Read every animation frame, so playback position, seeks and route changes
   * are drawn on the next frame without re-rendering this component.
   */
  getFrame: HighwayFrameSource;
}

/**
 * Notes travel toward the keyboard and reach its top edge when they sound. The
 * layer is decorative and never takes pointer input, like the keyboard below it.
 */
export function NoteHighway({ getFrame }: NoteHighwayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestGetFrame = useRef(getFrame);
  latestGetFrame.current = getFrame;

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
      const { track, now, window: span } = latestGetFrame.current();
      active.setTrack(track);
      // render() skips the GPU work and the painter skips unchanged keys, so
      // leaving the loop running while nothing moves costs almost nothing.
      active.render(now, span);
      active.keyApproach(now, span, approach);
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
