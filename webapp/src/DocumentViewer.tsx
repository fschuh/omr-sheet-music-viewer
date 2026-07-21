import { memo, useEffect, useMemo, useRef, useState } from "react";
import { layoutNoteLabels, selectedGroupIds } from "./noteLabels";
import { playbackGroupIdsForPage } from "./playback";
import type { PlaybackCommand, PlaybackMoment } from "./playback";
import type {
  DocumentPage,
  ViewportTransform,
  VisualBBox,
  VisualGroup,
  VisualGroupRef,
  VisualPoint,
  VisualSidecar,
} from "./types";

const MIN_SCALE = 0.08;
const MAX_SCALE = 6;
const CLICK_MOVE_TOLERANCE = 6;
const PAGE_GAP = 28;
const DEFAULT_VIEWPORT_TRANSFORM: ViewportTransform = { scale: 1, x: 24, y: 24 };
const SHOW_REFRESH_DIAGNOSTIC =
  typeof window !== "undefined" && window.location.hostname === "localhost";

interface DocumentViewerProps {
  documentKey: string;
  pages: DocumentPage[];
  selectedGroup: VisualGroupRef | null;
  highlightAllNotes: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  playbackActive: boolean;
  playbackNoteSoundsEnabled: boolean;
  playbackAvailable: boolean;
  playbackMoment: PlaybackMoment | null;
  initialViewportTransform?: ViewportTransform;
  onViewportTransformChange?: (transform: ViewportTransform) => void;
  onPlaybackCommand: (command: PlaybackCommand) => void;
  onSelectGroup: (group: VisualGroupRef | null) => void;
  onRetryPage: (pageIndex: number) => void;
}

interface PointerState {
  pointerId: number;
  x: number;
  y: number;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function useDisplayRefreshRate(enabled: boolean): number | null {
  const [refreshRate, setRefreshRate] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let previous: number | null = null;
    const intervals: number[] = [];
    function sample(timestamp: number) {
      if (previous !== null) {
        const interval = timestamp - previous;
        if (interval > 4 && interval < 40) intervals.push(interval);
      }
      previous = timestamp;
      if (intervals.length >= 90) {
        intervals.sort((first, second) => first - second);
        setRefreshRate(Math.round(1000 / intervals[Math.floor(intervals.length / 2)]));
        intervals.length = 0;
      }
      frame = requestAnimationFrame(sample);
    }
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return refreshRate;
}

function hasBBox(group: VisualGroup): group is VisualGroup & { bbox: VisualBBox } {
  return group.bbox.length === 4;
}

function pointInBBox(point: VisualPoint, group: VisualGroup): boolean {
  if (!hasBBox(group)) return false;
  const [x, y] = point;
  return x >= group.bbox[0] && x <= group.bbox[2] && y >= group.bbox[1] && y <= group.bbox[3];
}

function contourBBox(points: VisualPoint[]): VisualBBox | null {
  if (points.length === 0) return null;
  let left = points[0][0];
  let top = points[0][1];
  let right = left;
  let bottom = top;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

function pointInNotehead(point: VisualPoint, group: VisualGroup, padding = 3): boolean {
  return group.notehead_contours.some((contour) => {
    const bbox = contourBBox(contour);
    return (
      bbox !== null &&
      point[0] >= bbox[0] - padding &&
      point[0] <= bbox[2] + padding &&
      point[1] >= bbox[1] - padding &&
      point[1] <= bbox[3] + padding
    );
  });
}

function hitTest(sidecar: VisualSidecar, point: VisualPoint): VisualGroup | null {
  const noteheads = sidecar.visual_groups.filter((group) => pointInNotehead(point, group));
  const candidates = noteheads.length
    ? noteheads
    : sidecar.visual_groups.filter((group) => pointInBBox(point, group));
  return (
    candidates.sort(
      (first, second) =>
        Math.hypot(point[0] - first.center[0], point[1] - first.center[1]) -
        Math.hypot(point[0] - second.center[0], point[1] - second.center[1]),
    )[0] ?? null
  );
}

function pointerDistance(first: PointerState, second: PointerState): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: PointerState, second: PointerState): VisualPoint {
  return [(first.x + second.x) / 2, (first.y + second.y) / 2];
}

function pointsToSvg(points: VisualPoint[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function visualGroupBBox(group: VisualGroup): VisualBBox {
  if (hasBBox(group)) return group.bbox;
  const ellipses = group.notehead_ellipses ?? [];
  if (ellipses.length > 0) {
    return [
      Math.min(...ellipses.map((ellipse) => ellipse.center[0] - ellipse.rx)),
      Math.min(...ellipses.map((ellipse) => ellipse.center[1] - ellipse.ry)),
      Math.max(...ellipses.map((ellipse) => ellipse.center[0] + ellipse.rx)),
      Math.max(...ellipses.map((ellipse) => ellipse.center[1] + ellipse.ry)),
    ];
  }
  return [group.center[0] - 6, group.center[1] - 6, group.center[0] + 6, group.center[1] + 6];
}

interface PageOverlayProps {
  page: DocumentPage;
  selected: VisualGroupRef | null;
  highlightAll: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  playbackActive: boolean;
  playbackGroupIds: readonly string[];
}

const PageOverlay = memo(function PageOverlay({
  page,
  selected,
  highlightAll,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
  playbackActive,
  playbackGroupIds,
}: PageOverlayProps) {
  const selectedIds = useMemo(
    () => {
      if (playbackActive) return new Set(playbackGroupIds);
      return page.visualSidecar
        ? selectedGroupIds(page.visualSidecar, selected, page.index, highlightAll)
        : new Set<string>();
    },
    [highlightAll, page.index, page.visualSidecar, playbackActive, playbackGroupIds, selected],
  );
  const noteLabels = useMemo(
    () =>
      page.visualSidecar
        ? layoutNoteLabels(
            page.visualSidecar,
            selectedIds,
            page.width,
            page.height,
            page.musicXml,
          )
        : [],
    [page.height, page.musicXml, page.visualSidecar, page.width, selectedIds],
  );
  if (!page.visualSidecar) return null;
  const sidecar = page.visualSidecar;
  return (
    <svg
      className={`overlay${playbackActive ? " playback-overlay" : ""}`}
      viewBox={`0 0 ${page.width} ${page.height}`}
      aria-hidden="true"
    >
      {showRawStemContours
        ? sidecar.raw_stem_contours?.map((stem, index) => (
            <polyline
              key={`raw-stem-${stem.debug_id}-${index}`}
              className="raw-stem-contour"
              points={pointsToSvg(stem.contour)}
            />
          ))
        : null}
      {sidecar.visual_groups.map((group) => {
        const selectedClass = selectedIds.has(group.visual_group_id) ? " selected" : "";
        const playbackClass = playbackActive && selectedClass ? " playback-selected" : "";
        const fittedNoteheads = (group.notehead_ellipses?.length ?? 0) > 0;
        return (
          <g
            key={group.visual_group_id}
            className={`visual-group${selectedClass}${playbackClass}`}
            data-visual-group-id={group.visual_group_id}
            data-playback-selected={playbackClass ? "true" : undefined}
          >
            {fittedNoteheads && !showOriginalNoteheadContours
              ? group.notehead_ellipses?.map((ellipse, index) => (
                  <ellipse
                    key={`ellipse-${index}`}
                    cx={ellipse.center[0]}
                    cy={ellipse.center[1]}
                    rx={ellipse.rx}
                    ry={ellipse.ry}
                    transform={`rotate(${ellipse.angle} ${ellipse.center[0]} ${ellipse.center[1]})`}
                  />
                ))
              : group.notehead_contours.map((contour, index) => (
                  <polygon key={`notehead-${index}`} points={pointsToSvg(contour)} />
                ))}
            {showDetectedNoteheadContours
              ? group.detected_notehead_contours?.map((contour, index) => (
                  <polygon
                    key={`detected-notehead-${index}`}
                    className="detected-notehead-contour"
                    points={pointsToSvg(contour)}
                  />
                ))
              : null}
            {showRefinedNoteheadContours
              ? group.refined_notehead_contours?.map((contour, index) => (
                  <polygon
                    key={`refined-notehead-${index}`}
                    className="refined-notehead-contour"
                    points={pointsToSvg(contour)}
                  />
                ))
              : null}
            {group.stem_contours.map((contour, index) => (
              <polygon key={`stem-${index}`} points={pointsToSvg(contour)} />
            ))}
            {showRawStemContours
              ? group.detected_stem_contours?.map((contour, index) => (
                  <polyline
                    key={`detected-stem-${index}`}
                    className="detected-stem-contour"
                    points={pointsToSvg(contour)}
                  />
                ))
              : null}
          </g>
        );
      })}
      <g className="note-label-connectors">
        {noteLabels.map((label) => (
          <line
            key={`connector-${label.key}`}
            x1={label.anchor[0]}
            y1={label.anchor[1]}
            x2={label.connector[0]}
            y2={label.connector[1]}
          />
        ))}
      </g>
      <g className="note-labels">
        {noteLabels.map((label) => (
          <g
            key={label.key}
            className="note-label"
            data-musicxml-id={label.musicXmlId}
            data-visual-group-id={label.visualGroupId}
            data-label-x={label.x}
            data-label-y={label.y}
            data-label-width={label.width}
            data-label-height={label.height}
          >
            <rect
              x={label.x}
              y={label.y}
              width={label.width}
              height={label.height}
              rx={label.fontSize * 0.16}
            />
            <text
              x={label.x + label.width / 2}
              y={label.y + label.height / 2}
              fontSize={label.fontSize}
            >
              {label.text}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
});

export function DocumentViewer({
  documentKey,
  pages: documentPages,
  selectedGroup,
  highlightAllNotes,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
  playbackActive,
  playbackNoteSoundsEnabled,
  playbackAvailable,
  playbackMoment,
  initialViewportTransform,
  onViewportTransformChange,
  onPlaybackCommand,
  onSelectGroup,
  onRetryPage,
}: DocumentViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const activePointers = useRef(new Map<number, PointerState>());
  const dragStart = useRef<{ x: number; y: number; transform: ViewportTransform } | null>(null);
  const pinchStart = useRef<{
    distance: number;
    midpoint: VisualPoint;
    transform: ViewportTransform;
  } | null>(null);
  const autoFitMarker = useRef<string | null>(initialViewportTransform ? documentKey : null);
  const transformRef = useRef(initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM);
  const pendingTransform = useRef<ViewportTransform | null>(null);
  const transformFrame = useRef<number | null>(null);
  const onViewportTransformChangeRef = useRef(onViewportTransformChange);
  onViewportTransformChangeRef.current = onViewportTransformChange;
  const [transform, setTransform] = useState<ViewportTransform>(
    initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM,
  );
  const [isPointerPanning, setIsPointerPanning] = useState(false);
  const displayRefreshRate = useDisplayRefreshRate(SHOW_REFRESH_DIAGNOSTIC);
  const pages = useMemo(
    () => documentPages.filter((page) => page.status !== "skipped"),
    [documentPages],
  );
  const hasCompletePageRef = useRef(pages.some((page) => page.status === "complete"));
  hasCompletePageRef.current = pages.some((page) => page.status === "complete");

  function publishTransform(next: ViewportTransform) {
    if (hasCompletePageRef.current) onViewportTransformChangeRef.current?.(next);
  }

  function commitTransform(next: ViewportTransform) {
    if (transformFrame.current !== null) cancelAnimationFrame(transformFrame.current);
    transformFrame.current = null;
    pendingTransform.current = null;
    transformRef.current = next;
    setTransform(next);
    publishTransform(next);
  }

  function scheduleTransform(update: (current: ViewportTransform) => ViewportTransform) {
    const current = pendingTransform.current ?? transformRef.current;
    pendingTransform.current = update(current);
    if (transformFrame.current !== null) return;
    transformFrame.current = requestAnimationFrame(() => {
      transformFrame.current = null;
      const next = pendingTransform.current;
      pendingTransform.current = null;
      if (!next) return;
      transformRef.current = next;
      setTransform(next);
      publishTransform(next);
    });
  }

  useEffect(
    () => () => {
      if (transformFrame.current !== null) cancelAnimationFrame(transformFrame.current);
      const latestTransform = pendingTransform.current ?? transformRef.current;
      publishTransform(latestTransform);
    },
    [],
  );

  const layout = useMemo(
    () => ({
      width: Math.max(1, ...pages.map((page) => page.width)),
      height: pages.reduce((total, page) => total + page.height, 0) + PAGE_GAP * Math.max(0, pages.length - 1),
    }),
    [pages],
  );
  const firstRealPage = pages.find((page) => page.status === "complete");

  function fitWidth() {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = clampScale((rect.width - 64) / layout.width);
    commitTransform({ scale, x: (rect.width - layout.width * scale) / 2, y: 32 });
  }

  useEffect(() => {
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
    autoFitMarker.current = initialViewportTransform ? documentKey : null;
    setIsPointerPanning(false);
    commitTransform(initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM);
  }, [documentKey]);

  useEffect(() => {
    if (!firstRealPage || autoFitMarker.current === documentKey) return;
    autoFitMarker.current = documentKey;
    fitWidth();
  }, [documentKey, firstRealPage, layout.width]);

  function fitPage() {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || pages.length === 0) return;
    const page =
      pages.find((candidate) => candidate.index === selectedGroup?.pageIndex) ?? firstRealPage ?? pages[0];
    const pagePosition = pages.indexOf(page);
    const pageTop = pages
      .slice(0, pagePosition)
      .reduce((total, candidate) => total + candidate.height + PAGE_GAP, 0);
    const scale = clampScale(Math.min((rect.width - 64) / page.width, (rect.height - 64) / page.height));
    commitTransform({
      scale,
      x: (rect.width - layout.width * scale) / 2,
      y: (rect.height - page.height * scale) / 2 - pageTop * scale,
    });
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      if (event.ctrlKey) {
        const rect = stage?.getBoundingClientRect();
        if (!rect) return;
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        scheduleTransform((current) => {
          // Precision touchpads report pinch as Ctrl + wheel. Their deltas are
          // much smaller than mouse-wheel deltas, hence the higher sensitivity.
          const scale = clampScale(current.scale * Math.exp(-event.deltaY * 0.01));
          const documentX = (cursorX - current.x) / current.scale;
          const documentY = (cursorY - current.y) / current.scale;
          return {
            scale,
            x: cursorX - documentX * scale,
            y: cursorY - documentY * scale,
          };
        });
        return;
      }
      scheduleTransform((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    }

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.set(event.pointerId, {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPointerPanning(false);
    updatePointer(event);
    const pointers = Array.from(activePointers.current.values());
    if (pointers.length === 1) {
      dragStart.current = { x: event.clientX, y: event.clientY, transform };
      pinchStart.current = null;
    } else if (pointers.length === 2) {
      dragStart.current = null;
      pinchStart.current = {
        distance: pointerDistance(pointers[0], pointers[1]),
        midpoint: midpoint(pointers[0], pointers[1]),
        transform,
      };
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(event.pointerId)) return;
    updatePointer(event);
    const pointers = Array.from(activePointers.current.values());
    if (pointers.length === 1 && dragStart.current) {
      const start = dragStart.current;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVE_TOLERANCE) {
        setIsPointerPanning(true);
      }
      scheduleTransform(() => ({
        scale: start.transform.scale,
        x: start.transform.x + event.clientX - start.x,
        y: start.transform.y + event.clientY - start.y,
      }));
    } else if (pointers.length === 2 && pinchStart.current && pinchStart.current.distance > 0) {
      const start = pinchStart.current;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextMidpoint = midpoint(pointers[0], pointers[1]);
      const scale = clampScale(
        start.transform.scale * (pointerDistance(pointers[0], pointers[1]) / start.distance),
      );
      const documentX = (start.midpoint[0] - rect.left - start.transform.x) / start.transform.scale;
      const documentY = (start.midpoint[1] - rect.top - start.transform.y) / start.transform.scale;
      scheduleTransform(() => ({
        scale,
        x: nextMidpoint[0] - rect.left - documentX * scale,
        y: nextMidpoint[1] - rect.top - documentY * scale,
      }));
    }
  }

  function selectAt(clientX: number, clientY: number) {
    for (const page of pages) {
      if (!page.visualSidecar) continue;
      const element = pageRefs.current.get(page.index);
      const rect = element?.getBoundingClientRect();
      if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }
      const point: VisualPoint = [
        ((clientX - rect.left) / rect.width) * page.width,
        ((clientY - rect.top) / rect.height) * page.height,
      ];
      const group = hitTest(page.visualSidecar, point);
      onSelectGroup(
        group ? { pageIndex: page.index, visualGroupId: group.visual_group_id } : null,
      );
      return;
    }
    onSelectGroup(null);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    setIsPointerPanning(false);
    activePointers.current.delete(event.pointerId);
    if (start && activePointers.current.size === 0) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved <= CLICK_MOVE_TOLERANCE) selectAt(event.clientX, event.clientY);
    }
    if (activePointers.current.size === 0) {
      dragStart.current = null;
      pinchStart.current = null;
    }
  }

  useEffect(() => {
    if (!playbackActive || !playbackMoment) return;
    const stage = stageRef.current;
    const page = pages.find((candidate) => candidate.index === playbackMoment.pageIndex);
    const sidecar = page?.visualSidecar;
    const rect = stage?.getBoundingClientRect();
    if (!stage || !page || !sidecar || !rect) return;

    const staffGroups = sidecar.visual_groups.filter(
      (group) => group.staff_index === playbackMoment.staffIndex,
    );
    const momentIds = new Set(playbackMoment.visualGroupIds);
    const momentGroups = staffGroups.filter((group) => momentIds.has(group.visual_group_id));
    if (staffGroups.length === 0 || momentGroups.length === 0) return;

    const pageTop = pages
      .filter((candidate) => candidate.index < page.index)
      .reduce((total, candidate) => total + candidate.height + PAGE_GAP, 0);
    const pageLeft = (layout.width - page.width) / 2;
    const staffBoxes = staffGroups.map(visualGroupBBox);
    const momentBoxes = momentGroups.map(visualGroupBBox);
    const verticalPadding = Math.max(18, page.height * 0.018);
    const staffTop = pageTop + Math.min(...staffBoxes.map((box) => box[1])) - verticalPadding;
    const staffBottom = pageTop + Math.max(...staffBoxes.map((box) => box[3])) + verticalPadding;
    const momentLeft = pageLeft + Math.min(...momentBoxes.map((box) => box[0]));
    const momentRight = pageLeft + Math.max(...momentBoxes.map((box) => box[2]));
    const current = transformRef.current;
    const safeTop = rect.height * 0.12;
    const keyboardHeight = Math.min(210, Math.max(150, window.innerHeight * 0.24));
    const safeBottom = Math.max(safeTop + 80, rect.height - keyboardHeight - 20);
    const safeLeft = rect.width * 0.12;
    const safeRight = rect.width * 0.88;
    const screenStaffTop = current.y + staffTop * current.scale;
    const screenStaffBottom = current.y + staffBottom * current.scale;
    const screenMomentLeft = current.x + momentLeft * current.scale;
    const screenMomentRight = current.x + momentRight * current.scale;
    let x = current.x;
    let y = current.y;

    if (screenStaffTop < safeTop || screenStaffBottom > safeBottom) {
      const documentCenter = (staffTop + staffBottom) / 2;
      y = (safeTop + safeBottom) / 2 - documentCenter * current.scale;
    }
    if (screenMomentLeft < safeLeft || screenMomentRight > safeRight) {
      const documentCenter = (momentLeft + momentRight) / 2;
      x = rect.width / 2 - documentCenter * current.scale;
    }
    if (Math.abs(x - current.x) > 0.5 || Math.abs(y - current.y) > 0.5) {
      commitTransform({ ...current, x, y });
    }
  }, [layout.width, pages, playbackActive, playbackMoment]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button type="button" onClick={fitWidth}>Fit width</button>
        <button type="button" onClick={fitPage}>Fit page</button>
        <button type="button" onClick={() => commitTransform(DEFAULT_VIEWPORT_TRANSFORM)}>Reset</button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            const current = transformRef.current;
            commitTransform({ ...current, scale: clampScale(current.scale / 1.2) });
          }}
        >−</button>
        <span>{Math.round(transform.scale * 100)}%</span>
        {SHOW_REFRESH_DIAGNOSTIC && displayRefreshRate ? (
          <span title="Measured requestAnimationFrame cadence">~{displayRefreshRate} Hz</span>
        ) : null}
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            const current = transformRef.current;
            commitTransform({ ...current, scale: clampScale(current.scale * 1.2) });
          }}
        >+</button>
        <div className="toolbar-separator" aria-hidden="true" />
        <div className="playback-controls" role="group" aria-label="Playback controls">
          <button
            type="button"
            className={`playback-toggle${playbackActive ? " active" : ""}`}
            aria-label="Play"
            aria-pressed={playbackActive}
            title={playbackActive ? "Exit playback mode (Space)" : "Enter playback mode (Space)"}
            disabled={!playbackAvailable && !playbackActive}
            onClick={() => onPlaybackCommand("togglePlayback")}
          >{playbackActive ? "■" : "▶"}</button>
          <button
            type="button"
            className={`sound-toggle${playbackNoteSoundsEnabled ? " active" : ""}`}
            aria-label={playbackNoteSoundsEnabled ? "Mute note sounds" : "Play note sounds"}
            aria-pressed={playbackNoteSoundsEnabled}
            title={playbackNoteSoundsEnabled ? "Mute note sounds (M)" : "Play note sounds (M)"}
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("toggleNoteSounds")}
          >{playbackNoteSoundsEnabled ? "🔊" : "🔇"}</button>
          <button
            type="button"
            aria-label="Backward one page"
            title="Backward one page (Up arrow)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("backwardPage")}
          >⇤</button>
          <button
            type="button"
            aria-label="Backward one bar"
            title="Backward one bar (Comma)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("backwardBar")}
          >←│</button>
          <button
            type="button"
            aria-label="Backward one note"
            title="Backward one note (Left arrow)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("backwardNote")}
          >←</button>
          <button
            type="button"
            aria-label="Forward one note"
            title="Forward one note (Right arrow)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("forwardNote")}
          >→</button>
          <button
            type="button"
            aria-label="Forward one bar"
            title="Forward one bar (Period)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("forwardBar")}
          >│→</button>
          <button
            type="button"
            aria-label="Forward one page"
            title="Forward one page (Down arrow)"
            disabled={!playbackActive}
            onClick={() => onPlaybackCommand("forwardPage")}
          >⇥</button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={`viewer-stage${isPointerPanning ? " is-pointer-panning" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="document-content"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          {pages.map((page, pagePosition) => (
            <div
              key={page.index}
              ref={(element) => {
                if (element) pageRefs.current.set(page.index, element);
                else pageRefs.current.delete(page.index);
              }}
              className={`document-page page-${page.status}`}
              style={{ width: page.width, height: page.height, marginBottom: pagePosition === pages.length - 1 ? 0 : PAGE_GAP }}
            >
              <span className="page-number">{page.index + 1}</span>
              {page.imageUrl ? <img src={page.imageUrl} alt={`Sheet music page ${page.index + 1}`} draggable={false} /> : null}
              <PageOverlay
                page={page}
                selected={selectedGroup}
                highlightAll={highlightAllNotes}
                playbackActive={playbackActive}
                playbackGroupIds={playbackGroupIdsForPage(playbackMoment, page.index)}
                showOriginalNoteheadContours={showOriginalNoteheadContours}
                showDetectedNoteheadContours={showDetectedNoteheadContours}
                showRefinedNoteheadContours={showRefinedNoteheadContours}
                showRawStemContours={showRawStemContours}
              />
              {page.status !== "complete" ? (
                <div className="page-placeholder">
                  {page.status === "failed" ? (
                    <>
                      <strong>Page {page.index + 1} failed</strong>
                      <span>{page.error}</span>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onRetryPage(page.index)}
                      >Retry page</button>
                    </>
                  ) : (
                    <>
                      <span className={page.status === "processing" ? "spinner" : "page-pending-dot"} />
                      <span>{page.status === "loading" ? "Loading recognized notes…" : page.status === "processing" ? "Recognizing page…" : "Waiting to process…"}</span>
                    </>
                  )}
                </div>
              ) : null}
              {page.cached && page.status === "complete" ? <span className="cache-badge">Cached</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
