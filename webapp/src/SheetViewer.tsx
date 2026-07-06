import { useEffect, useMemo, useRef, useState } from "react";
import type { Sidecar, ViewportTransform, VisualBBox, VisualGroup, VisualPoint } from "./types";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const CLICK_MOVE_TOLERANCE = 6;

interface SheetViewerProps {
  imageUrl: string;
  sidecar: Sidecar;
  selectedGroupId: string | null;
  highlightAllNotes: boolean;
  showOriginalNoteheadContours: boolean;
  onSelectGroup: (group: VisualGroup | null) => void;
}

interface PointerState {
  pointerId: number;
  x: number;
  y: number;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function getBBoxCenter(group: VisualGroup): VisualPoint {
  if (group.bbox.length === 4) {
    return [(group.bbox[0] + group.bbox[2]) / 2, (group.bbox[1] + group.bbox[3]) / 2];
  }
  return group.center;
}

function hasBBox(group: VisualGroup): group is VisualGroup & { bbox: VisualBBox } {
  return group.bbox.length === 4;
}

function pointInBBox(point: VisualPoint, group: VisualGroup): boolean {
  if (!hasBBox(group)) {
    return false;
  }
  const [x, y] = point;
  return x >= group.bbox[0] && x <= group.bbox[2] && y >= group.bbox[1] && y <= group.bbox[3];
}

function distanceToPoint(a: VisualPoint, b: VisualPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function contourBBox(points: VisualPoint[]): [number, number, number, number] | null {
  if (points.length === 0) {
    return null;
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function boxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  padding = 3,
): boolean {
  return (
    a[0] - padding <= b[2] &&
    a[2] + padding >= b[0] &&
    a[1] - padding <= b[3] &&
    a[3] + padding >= b[1]
  );
}

function groupStemBBoxes(group: VisualGroup): [number, number, number, number][] {
  return group.stem_contours
    .map((contour) => contourBBox(contour))
    .filter((bbox): bbox is [number, number, number, number] => bbox !== null);
}

function groupBBoxesOverlapStem(
  group: VisualGroup,
  stemBBoxes: [number, number, number, number][],
): boolean {
  if (!hasBBox(group)) {
    return false;
  }
  return stemBBoxes.some((stemBBox) => boxesOverlap(group.bbox, stemBBox));
}

function pointerDistance(a: PointerState, b: PointerState): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: PointerState, b: PointerState): VisualPoint {
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

function pointsToSvg(points: VisualPoint[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function hasFittedNoteheads(group: VisualGroup): boolean {
  return (group.notehead_ellipses?.length ?? 0) > 0;
}

export function SheetViewer({
  imageUrl,
  sidecar,
  selectedGroupId,
  highlightAllNotes,
  showOriginalNoteheadContours,
  onSelectGroup,
}: SheetViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePointers = useRef(new Map<number, PointerState>());
  const dragStart = useRef<{ x: number; y: number; transform: ViewportTransform } | null>(null);
  const pinchStart = useRef<{
    distance: number;
    midpoint: VisualPoint;
    transform: ViewportTransform;
  } | null>(null);

  const [imageSize, setImageSize] = useState<[number, number]>(sidecar.source_image_size);
  const [transform, setTransform] = useState<ViewportTransform>({ scale: 1, x: 0, y: 0 });

  const visualGroups = sidecar.visual_groups;

  useEffect(() => {
    setImageSize(sidecar.source_image_size);
    setTransform({ scale: 1, x: 0, y: 0 });
    activePointers.current.clear();
    dragStart.current = null;
    pinchStart.current = null;
  }, [imageUrl, sidecar]);

  const selectedGroup = useMemo(
    () => visualGroups.find((group) => group.visual_group_id === selectedGroupId) ?? null,
    [selectedGroupId, visualGroups],
  );

  const selectedGroupIds = useMemo(() => {
    if (highlightAllNotes) {
      return new Set(visualGroups.map((group) => group.visual_group_id));
    }

    if (!selectedGroup) {
      return new Set<string>();
    }

    const selectedStemBBoxes = groupStemBBoxes(selectedGroup);
    if (selectedStemBBoxes.length === 0) {
      return new Set([selectedGroup.visual_group_id]);
    }

    const ids = new Set<string>([selectedGroup.visual_group_id]);
    for (const group of visualGroups) {
      if (group.visual_group_id === selectedGroup.visual_group_id) {
        continue;
      }

      const hasSharedStem = groupStemBBoxes(group).some((candidateBBox) =>
        selectedStemBBoxes.some((selectedBBox) => boxesOverlap(candidateBBox, selectedBBox)),
      );
      if (hasSharedStem || groupBBoxesOverlapStem(group, selectedStemBBoxes)) {
        ids.add(group.visual_group_id);
      }
    }

    return ids;
  }, [highlightAllNotes, selectedGroup, visualGroups]);

  function clientToImagePoint(clientX: number, clientY: number): VisualPoint {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return [0, 0];
    }
    return [
      (clientX - rect.left - transform.x) / transform.scale,
      (clientY - rect.top - transform.y) / transform.scale,
    ];
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const scale = clampScale(nextScale);
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const imageX = (cursorX - transform.x) / transform.scale;
    const imageY = (cursorY - transform.y) / transform.scale;

    setTransform({
      scale,
      x: cursorX - imageX * scale,
      y: cursorY - imageY * scale,
    });
  }

  function hitTest(point: VisualPoint): VisualGroup | null {
    const candidates = visualGroups.filter((group) => pointInBBox(point, group));
    if (candidates.length === 0) {
      return null;
    }
    return candidates.sort(
      (a, b) => distanceToPoint(point, getBBoxCenter(a)) - distanceToPoint(point, getBBoxCenter(b)),
    )[0];
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
      dragStart.current = {
        x: event.clientX,
        y: event.clientY,
        transform,
      };
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
    if (!activePointers.current.has(event.pointerId)) {
      return;
    }
    updatePointer(event);
    const pointers = Array.from(activePointers.current.values());

    if (pointers.length === 1 && dragStart.current) {
      const start = dragStart.current;
      setTransform({
        scale: start.transform.scale,
        x: start.transform.x + event.clientX - start.x,
        y: start.transform.y + event.clientY - start.y,
      });
      return;
    }

    if (pointers.length === 2 && pinchStart.current) {
      const start = pinchStart.current;
      const nextDistance = pointerDistance(pointers[0], pointers[1]);
      if (start.distance === 0) {
        return;
      }

      const nextMidpoint = midpoint(pointers[0], pointers[1]);
      const nextScale = clampScale(start.transform.scale * (nextDistance / start.distance));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const imageX = (start.midpoint[0] - rect.left - start.transform.x) / start.transform.scale;
      const imageY = (start.midpoint[1] - rect.top - start.transform.y) / start.transform.scale;
      setTransform({
        scale: nextScale,
        x: nextMidpoint[0] - rect.left - imageX * nextScale,
        y: nextMidpoint[1] - rect.top - imageY * nextScale,
      });
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    activePointers.current.delete(event.pointerId);

    if (start && activePointers.current.size === 0) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved <= CLICK_MOVE_TOLERANCE) {
        onSelectGroup(hitTest(clientToImagePoint(event.clientX, event.clientY)));
      }
    }

    if (activePointers.current.size === 0) {
      dragStart.current = null;
      pinchStart.current = null;
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    zoomAt(event.clientX, event.clientY, transform.scale * zoomFactor);
  }

  const contentTransform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  const [width, height] = imageSize;

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button type="button" onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}>
          Reset
        </button>
        <span>{Math.round(transform.scale * 100)}%</span>
      </div>
      <div
        ref={containerRef}
        className="viewer-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="score-content"
          style={{
            width,
            height,
            transform: contentTransform,
          }}
        >
          <img
            src={imageUrl}
            alt="Loaded sheet music"
            draggable={false}
            onLoad={(event) =>
              setImageSize([
                event.currentTarget.naturalWidth || sidecar.source_image_size[0],
                event.currentTarget.naturalHeight || sidecar.source_image_size[1],
              ])
            }
          />
          <svg className="overlay" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {visualGroups.map((group) => {
              const isSelected = selectedGroupIds.has(group.visual_group_id);
              return (
                <g
                  key={group.visual_group_id}
                  className={isSelected ? "visual-group selected" : "visual-group"}
                >
                  {hasFittedNoteheads(group) && !showOriginalNoteheadContours
                    ? group.notehead_ellipses?.map((ellipse, index) => (
                        <ellipse
                          key={`notehead-ellipse-${index}`}
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
                  {group.stem_contours.map((contour, index) => (
                    <polygon key={`stem-${index}`} points={pointsToSvg(contour)} />
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
        {highlightAllNotes ? (
          <div className="selection-chip">All notes</div>
        ) : selectedGroup ? (
          <div className="selection-chip">
            {selectedGroup.visual_group_id}
            {selectedGroup.musicxml_ids.length > 0 ? ` / ${selectedGroup.musicxml_ids[0]}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
