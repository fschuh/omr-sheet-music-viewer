import { useEffect, useMemo, useRef, useState } from "react";
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

interface DocumentViewerProps {
  documentKey: string;
  pages: DocumentPage[];
  selectedGroup: VisualGroupRef | null;
  highlightAllNotes: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
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

function selectedGroupIds(
  sidecar: VisualSidecar,
  selected: VisualGroupRef | null,
  pageIndex: number,
  highlightAll: boolean,
): Set<string> {
  if (highlightAll) return new Set(sidecar.visual_groups.map((group) => group.visual_group_id));
  if (!selected || selected.pageIndex !== pageIndex) return new Set();
  const group = sidecar.visual_groups.find(
    (candidate) => candidate.visual_group_id === selected.visualGroupId,
  );
  if (!group) return new Set();
  const stemComponents = new Set(group.stem_component_ids ?? []);
  if (stemComponents.size === 0) return new Set([group.visual_group_id]);
  return new Set(
    sidecar.visual_groups
      .filter((candidate) =>
        (candidate.stem_component_ids ?? []).some((component) => stemComponents.has(component)),
      )
      .map((candidate) => candidate.visual_group_id),
  );
}

interface PageOverlayProps {
  page: DocumentPage;
  selected: VisualGroupRef | null;
  highlightAll: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
}

function PageOverlay({
  page,
  selected,
  highlightAll,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
}: PageOverlayProps) {
  if (!page.visualSidecar) return null;
  const sidecar = page.visualSidecar;
  const selectedIds = selectedGroupIds(sidecar, selected, page.index, highlightAll);
  return (
    <svg className="overlay" viewBox={`0 0 ${page.width} ${page.height}`} aria-hidden="true">
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
        const fittedNoteheads = (group.notehead_ellipses?.length ?? 0) > 0;
        return (
          <g key={group.visual_group_id} className={`visual-group${selectedClass}`}>
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
    </svg>
  );
}

export function DocumentViewer({
  documentKey,
  pages,
  selectedGroup,
  highlightAllNotes,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
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
  const autoFitMarker = useRef<string | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>({ scale: 1, x: 24, y: 24 });

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
    setTransform({ scale, x: (rect.width - layout.width * scale) / 2, y: 32 });
  }

  useEffect(() => {
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
    autoFitMarker.current = null;
    setTransform({ scale: 1, x: 24, y: 24 });
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
    const pageTop = pages
      .slice(0, page.index)
      .reduce((total, candidate) => total + candidate.height + PAGE_GAP, 0);
    const scale = clampScale(Math.min((rect.width - 64) / page.width, (rect.height - 64) / page.height));
    setTransform({
      scale,
      x: (rect.width - layout.width * scale) / 2,
      y: (rect.height - page.height * scale) / 2 - pageTop * scale,
    });
  }

  function zoomAt(clientX: number, clientY: number, requestedScale: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = clampScale(requestedScale);
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const documentX = (cursorX - transform.x) / transform.scale;
    const documentY = (cursorY - transform.y) / transform.scale;
    setTransform({
      scale,
      x: cursorX - documentX * scale,
      y: cursorY - documentY * scale,
    });
  }

  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.set(event.pointerId, {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
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
      setTransform({
        scale: start.transform.scale,
        x: start.transform.x + event.clientX - start.x,
        y: start.transform.y + event.clientY - start.y,
      });
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
      setTransform({
        scale,
        x: nextMidpoint[0] - rect.left - documentX * scale,
        y: nextMidpoint[1] - rect.top - documentY * scale,
      });
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

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button type="button" onClick={fitWidth}>Fit width</button>
        <button type="button" onClick={fitPage}>Fit page</button>
        <button type="button" onClick={() => setTransform({ scale: 1, x: 24, y: 24 })}>Reset</button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setTransform((current) => ({ ...current, scale: clampScale(current.scale / 1.2) }))}
        >−</button>
        <span>{Math.round(transform.scale * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setTransform((current) => ({ ...current, scale: clampScale(current.scale * 1.2) }))}
        >+</button>
      </div>
      <div
        ref={stageRef}
        className="viewer-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.clientX, event.clientY, transform.scale * Math.exp(-event.deltaY * 0.001));
        }}
      >
        <div
          className="document-content"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {pages.map((page) => (
            <div
              key={page.index}
              ref={(element) => {
                if (element) pageRefs.current.set(page.index, element);
                else pageRefs.current.delete(page.index);
              }}
              className={`document-page page-${page.status}`}
              style={{ width: page.width, height: page.height, marginBottom: page.index === pages.length - 1 ? 0 : PAGE_GAP }}
            >
              <span className="page-number">{page.index + 1}</span>
              {page.imageUrl ? <img src={page.imageUrl} alt={`Sheet music page ${page.index + 1}`} draggable={false} /> : null}
              <PageOverlay
                page={page}
                selected={selectedGroup}
                highlightAll={highlightAllNotes}
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
