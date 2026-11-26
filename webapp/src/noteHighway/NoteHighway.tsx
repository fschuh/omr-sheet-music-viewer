import { useEffect, useRef } from "react";
import { NOTE_HIGHWAY_TOP_FRACTION } from "./highwayModel";
import { DEFAULT_HIGHWAY_RENDER_VIEW, NoteHighwayRenderer, type HighwayRenderView } from "./highwayRenderer";
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
  /** Out of sight for a while, keeping its size and WebGL context. */
  hidden?: boolean;
  /** Pass a new object to change it; the same one again changes nothing. */
  view?: HighwayRenderView;
  /**
   * The share of the highway, from the keys, over which a key shows its next
   * note coming; 0 shows nothing.
   */
  upcomingLead?: number;
  /**
   * Where, in the window's coordinates, the highway's far end is cleared down to, leaving
   * what lies above it in sight; null clears nothing beyond its usual fade.
   */
  clearTo?: number | null;
}

/**
 * Notes travel toward the keyboard and reach its top edge when they sound. The
 * layer is decorative and never takes pointer input, like the keyboard below it.
 * With a 3D keyboard the canvas reaches down over the keyboard's box, whose keys
 * lie on the highway's floor in front of the notes.
 */
export function NoteHighway({
  getFrame,
  hidden = false,
  view = DEFAULT_HIGHWAY_RENDER_VIEW,
  upcomingLead = 1,
  clearTo = null,
}: NoteHighwayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ getFrame, view, upcomingLead, hidden, clearTo });
  latest.current = { getFrame, view, upcomingLead, hidden, clearTo };

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
    active.setView(latest.current.view);

    // The clearing line as a share of the canvas's height, measured again when it or the
    // canvas changes.
    let clearedFor: { to: number | null; size: string } | null = null;
    const resize = () => {
      clearedFor = null;
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
    const approachHands = new Uint8Array(88);

    let frame = 0;
    let wasHidden = false;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { getFrame: currentGetFrame, view: currentView, upcomingLead: lead, hidden: hiddenNow } = latest.current;
      // Hidden, it draws nothing, on the keys either, and waits with its context to be shown.
      if (hiddenNow) {
        if (!wasHidden) approachPainter.clear();
        wasHidden = true;
        return;
      }
      wasHidden = false;
      const { track, now, window: span } = currentGetFrame();
      active.setView(currentView);
      active.setTrack(track);
      const to = latest.current.clearTo;
      if (clearedFor?.to !== to) {
        const box = canvas.getBoundingClientRect();
        active.setClear(to === null || box.height <= 0 ? 0 : (to - box.top) / box.height);
        clearedFor = { to, size: `${box.width}x${box.height}` };
      }
      // render() skips the GPU work and the painter skips unchanged keys, so
      // leaving the loop running while nothing moves costs almost nothing.
      active.render(now, span);
      active.keyApproach(now, span * lead, approach, approachHands);
      approachPainter.paint(approach, approachHands);
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
      className={`note-highway${view.keyboard3d ? " keyboard-3d" : ""}`}
      style={{ top: `${NOTE_HIGHWAY_TOP_FRACTION * 100}%`, visibility: hidden ? "hidden" : undefined }}
      aria-hidden="true"
    />
  );
}
