import { useState, type PointerEvent } from "react";
import { anchorInRegion, type FingeringRegion } from "./fingeringPolicy";
import type { VisualBBox, VisualPoint } from "./types";

export function FingeringExclusionLayer({ width, height, regions, anchors, onAdd }: {
  width: number; height: number; regions: FingeringRegion[]; anchors: VisualPoint[]; onAdd: (bounds: VisualBBox) => void;
}) {
  const [start, setStart] = useState<VisualPoint>();
  const [end, setEnd] = useState<VisualPoint>();
  const point = (event: PointerEvent<SVGGElement>): VisualPoint => {
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return [Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width)),
      Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height))];
  };
  const bounds = (a: VisualPoint, b: VisualPoint): VisualBBox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const preview = start && end ? bounds(start, end) : undefined;
  return <g className="fingering-exclusions" style={{ touchAction: "none" }}
    onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.stopPropagation(); event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId); setStart(point(event)); setEnd(point(event)); }}
    onPointerMove={event => { event.stopPropagation(); if (start) setEnd(point(event)); }}
    onPointerUp={event => { event.stopPropagation(); if (start) { const box = bounds(start, point(event));
      if (box[2] - box[0] >= 2 && box[3] - box[1] >= 2) onAdd(box); }
      setStart(undefined); setEnd(undefined); }}
    onPointerCancel={event => { event.stopPropagation(); setStart(undefined); setEnd(undefined); }}>
    <rect width={width} height={height} fill="transparent" pointerEvents="all" style={{ cursor: "crosshair" }} />
    {[...regions.map(region => region.bounds), ...(preview ? [preview] : [])].map((box, index) =>
      <rect key={index} x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]}
        fill="#d33" fillOpacity={0.15} stroke="#b22" strokeWidth={2} pointerEvents="none" />)}
    {preview ? anchors.filter(anchor => anchorInRegion(anchor, preview)).map((anchor, index) =>
      <circle key={index} cx={anchor[0]} cy={anchor[1]} r={6} fill="none" stroke="#d00" strokeWidth={2} pointerEvents="none" />) : null}
  </g>;
}
