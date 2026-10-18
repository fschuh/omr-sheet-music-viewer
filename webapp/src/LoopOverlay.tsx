// The loop drawn on one page: a tint behind the looped bars, the rest dimmed, and a pair
// of bracket handles on the loop's barlines. Positions come from the page's systems, in
// page pixels; sizes are screen pixels, divided by the zoom so they stay the same at any
// zoom. The tint is a layer of its own that multiplies onto the page, so it reads as
// behind the ink; everything else is drawn over the score and under the note overlay.
import { memo, type KeyboardEvent, type PointerEvent } from "react";
import {
  loopBoundaryPlacement,
  loopDimSpans,
  loopHandleBar,
  loopLabel,
  type LoopHandle,
  type LoopRegion,
  type LoopSegment,
  type LoopSystem,
} from "./loop";

/** Screen-pixel sizes from the design. */
const TINT_OVERHANG = 22;
const BAR_OVERHANG = 24;
const BAR_WIDTH = 4;
const BAR_WIDTH_ACTIVE = 6;
const FOOT_LENGTH = 14;
const FOOT_THICKNESS = 4;
const TAB_WIDTH = 26;
const TAB_HEIGHT = 40;
const TAB_WIDTH_ACTIVE = 30;
const TAB_HEIGHT_ACTIVE = 38;
const TAB_RADIUS = 7;
const HALO_WIDTH = 40;
const HALO_HEIGHT = 48;
const HALO_RADIUS = 11;
const GRIP_LENGTH = 12;
const GRIP_GAP = 8;
const HIT_WIDTH = 32;
const PILL_WIDTH = 140;
const PILL_HEIGHT = 28;
/** The label is left out of a loop narrower than this on screen. */
const PILL_MIN_REGION_WIDTH = 200;
/** How far, in screen pixels, a handle reaches above and below its system's staves. */
export const LOOP_HANDLE_REACH = { above: BAR_OVERHANG + TAB_HEIGHT, below: BAR_OVERHANG };
const CHEVRON_OFFSET = 10;
const CHEVRON_HALF_HEIGHT = 6;
const CHEVRON_DEPTH = 6;
const TOOLTIP_HEIGHT = 26;
const TOOLTIP_GAP = 8;

export interface LoopHandleEvents {
  onPointerDown(handle: LoopHandle, event: PointerEvent<SVGElement>): void;
  onPointerMove(event: PointerEvent<SVGElement>): void;
  onPointerUp(event: PointerEvent<SVGElement>): void;
  onPointerCancel(event: PointerEvent<SVGElement>): void;
  onKeyDown(handle: LoopHandle, event: KeyboardEvent<SVGElement>): void;
  onHover(handle: LoopHandle | null): void;
}

interface LoopPageLayerProps {
  pageIndex: number;
  width: number;
  height: number;
  /** Every system of the document; the layer draws those on its page. */
  systems: readonly LoopSystem[];
  region: LoopRegion;
  segments: readonly LoopSegment[];
  /** The segment that carries the label, which may be on another page. */
  labelSegment: LoopSegment | null;
  /** Screen pixels per page pixel. */
  scale: number;
  measureCount: number;
  dimOutside: boolean;
  dragging: LoopHandle | null;
  hover: LoopHandle | null;
  events: LoopHandleEvents;
}

function systemsOnPage(systems: readonly LoopSystem[], pageIndex: number): LoopSystem[] {
  return systems
    .filter((system) => system.pageIndex === pageIndex)
    .sort((first, second) => first.top - second.top);
}

/** The band a system's dimming covers: halfway to the systems around it. */
function dimBand(onPage: readonly LoopSystem[], position: number, pageHeight: number): [number, number] {
  const system = onPage[position];
  const reach = (system.bottom - system.top) * 0.45;
  const above = onPage[position - 1];
  const below = onPage[position + 1];
  return [
    above ? (above.bottom + system.top) / 2 : Math.max(0, system.top - reach),
    below ? (system.bottom + below.top) / 2 : Math.min(pageHeight, system.bottom + reach),
  ];
}

export const LoopPageTint = memo(function LoopPageTint({
  width,
  height,
  segments,
  scale,
  active,
}: {
  width: number;
  height: number;
  segments: readonly LoopSegment[];
  scale: number;
  /** A handle is hovered or held, which deepens the tint. */
  active: boolean;
}) {
  const unit = 1 / scale;
  return (
    <svg className="loop-tint-layer" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {segments.map((segment) => (
        <rect
          key={`${segment.system.pageIndex}-${segment.system.systemIndex}`}
          className={`loop-tint${active ? " active" : ""}`}
          data-testid="loop-tint"
          x={segment.left}
          y={segment.system.top - TINT_OVERHANG * unit}
          width={segment.right - segment.left}
          height={segment.system.bottom - segment.system.top + 2 * TINT_OVERHANG * unit}
        />
      ))}
    </svg>
  );
});

function Handle({
  handle,
  x,
  system,
  region,
  measureCount,
  unit,
  active,
  dragging,
  events,
}: {
  handle: LoopHandle;
  x: number;
  system: LoopSystem;
  region: LoopRegion;
  measureCount: number;
  unit: number;
  active: boolean;
  dragging: boolean;
  events: LoopHandleEvents;
}) {
  const barTop = system.top - BAR_OVERHANG * unit;
  const barBottom = system.bottom + BAR_OVERHANG * unit;
  const barWidth = (active ? BAR_WIDTH_ACTIVE : BAR_WIDTH) * unit;
  const tabWidth = (active ? TAB_WIDTH_ACTIVE : TAB_WIDTH) * unit;
  const tabHeight = (active ? TAB_HEIGHT_ACTIVE : TAB_HEIGHT) * unit;
  const tabTop = barTop - tabHeight;
  const tabCenterY = barTop - tabHeight / 2;
  // Feet point into the loop, so the pair reads as [ … ].
  const footLeft = handle === "start" ? x - barWidth / 2 : x + barWidth / 2 - FOOT_LENGTH * unit;
  const bar = loopHandleBar(region, handle);
  const label = handle === "start" ? "Loop start" : "Loop end";
  const tooltip = `${handle === "start" ? "Start" : "End"} · bar ${bar}`;
  const tooltipWidth = (tooltip.length * 7 + 20) * unit;
  const tooltipX = handle === "start"
    ? x + tabWidth / 2 + TOOLTIP_GAP * unit
    : x - tabWidth / 2 - TOOLTIP_GAP * unit - tooltipWidth;
  return (
    <g
      className={`loop-handle loop-handle-${handle}${active ? " active" : ""}${dragging ? " dragging" : ""}`}
      data-loop-handle={handle}
    >
      {active ? (
        <rect
          className="loop-handle-halo"
          x={x - (HALO_WIDTH * unit) / 2}
          y={tabCenterY - (HALO_HEIGHT * unit) / 2}
          width={HALO_WIDTH * unit}
          height={HALO_HEIGHT * unit}
          rx={HALO_RADIUS * unit}
        />
      ) : null}
      <rect
        className="loop-handle-bar"
        x={x - barWidth / 2}
        y={barTop}
        width={barWidth}
        height={barBottom - barTop}
        rx={unit}
      />
      <rect className="loop-handle-bar" x={footLeft} y={barTop} width={FOOT_LENGTH * unit} height={FOOT_THICKNESS * unit} />
      <rect
        className="loop-handle-bar"
        x={footLeft}
        y={barBottom - FOOT_THICKNESS * unit}
        width={FOOT_LENGTH * unit}
        height={FOOT_THICKNESS * unit}
      />
      <rect
        className="loop-handle-bar"
        x={x - tabWidth / 2}
        y={tabTop}
        width={tabWidth}
        height={tabHeight}
        rx={TAB_RADIUS * unit}
      />
      {[-1, 0, 1].map((line) => (
        <line
          key={line}
          className="loop-handle-grip"
          x1={x - (GRIP_LENGTH * unit) / 2}
          x2={x + (GRIP_LENGTH * unit) / 2}
          y1={tabCenterY + line * GRIP_GAP * unit}
          y2={tabCenterY + line * GRIP_GAP * unit}
          strokeWidth={2 * unit}
        />
      ))}
      {dragging ? (
        <g className="loop-tooltip" data-testid="loop-drag-tooltip">
          <rect
            x={tooltipX}
            y={tabCenterY - (TOOLTIP_HEIGHT * unit) / 2}
            width={tooltipWidth}
            height={TOOLTIP_HEIGHT * unit}
            rx={6 * unit}
          />
          <text x={tooltipX + tooltipWidth / 2} y={tabCenterY} fontSize={12 * unit}>{tooltip}</text>
        </g>
      ) : null}
      <rect
        className="loop-handle-hit"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={handle === "start" ? 1 : region.startMeasure + 1}
        aria-valuemax={handle === "start" ? region.endMeasure : measureCount}
        aria-valuenow={bar}
        aria-valuetext={`Bar ${bar}`}
        x={x - (HIT_WIDTH * unit) / 2}
        y={tabTop}
        width={HIT_WIDTH * unit}
        height={barBottom - tabTop}
        onPointerDown={(event) => events.onPointerDown(handle, event)}
        onPointerMove={events.onPointerMove}
        onPointerUp={events.onPointerUp}
        onPointerCancel={events.onPointerCancel}
        onPointerEnter={() => events.onHover(handle)}
        onPointerLeave={() => events.onHover(null)}
        onFocus={() => events.onHover(handle)}
        onBlur={() => events.onHover(null)}
        onKeyDown={(event) => events.onKeyDown(handle, event)}
      >
        <title>{`${label} · bar ${bar}`}</title>
      </rect>
    </g>
  );
}

function Chevron({ x, y, unit }: { x: number; y: number; unit: number }) {
  const depth = (CHEVRON_DEPTH * unit) / 2;
  const half = CHEVRON_HALF_HEIGHT * unit;
  return (
    <polyline
      className="loop-chevron"
      data-testid="loop-chevron"
      points={`${x - depth},${y - half} ${x + depth},${y} ${x - depth},${y + half}`}
      strokeWidth={2.2 * unit}
    />
  );
}

export const LoopPageLayer = memo(function LoopPageLayer({
  pageIndex,
  width,
  height,
  systems,
  region,
  segments,
  labelSegment,
  scale,
  measureCount,
  dimOutside,
  dragging,
  hover,
  events,
}: LoopPageLayerProps) {
  const unit = 1 / scale;
  const onPage = systemsOnPage(systems, pageIndex);
  const pageSegments = segments.filter((segment) => segment.system.pageIndex === pageIndex);
  const handles = (["start", "end"] as const).flatMap((handle) => {
    const placement = loopBoundaryPlacement(
      systems,
      handle === "start" ? region.startMeasure : region.endMeasure,
      handle,
    );
    return placement && placement.system.pageIndex === pageIndex ? [{ handle, ...placement }] : [];
  });
  const showLabel = labelSegment !== null &&
    labelSegment.system.pageIndex === pageIndex &&
    dragging === null &&
    (labelSegment.right - labelSegment.left) * scale >= PILL_MIN_REGION_WIDTH;
  return (
    <svg
      className="loop-layer"
      viewBox={`0 0 ${width} ${height}`}
      data-testid="loop-layer"
      data-loop-page={pageIndex}
    >
      {dimOutside
        ? onPage.flatMap((system, position) => {
            const [top, bottom] = dimBand(onPage, position, height);
            return loopDimSpans(system, region).map(([left, right]) => (
              <rect
                key={`dim-${system.systemIndex}-${left}`}
                className="loop-dim"
                data-testid="loop-dim"
                x={left}
                y={top}
                width={right - left}
                height={bottom - top}
              />
            ));
          })
        : null}
      {pageSegments.map((segment) => {
        const top = segment.system.top - TINT_OVERHANG * unit;
        const bottom = segment.system.bottom + TINT_OVERHANG * unit;
        const middle = (segment.system.top + segment.system.bottom) / 2;
        const firstOnLine = segment.system.barlines[0];
        const lastOnLine = segment.system.barlines[segment.system.barlines.length - 1];
        return (
          <g key={`edges-${segment.system.systemIndex}`} className="loop-region">
            <line className="loop-edge" x1={segment.left} x2={segment.right} y1={top} y2={top} strokeWidth={2 * unit} />
            <line className="loop-edge" x1={segment.left} x2={segment.right} y1={bottom} y2={bottom} strokeWidth={2 * unit} />
            {/* The loop goes on from the line before, or onto the next one. */}
            {segment.startsHere ? null : <Chevron x={firstOnLine - CHEVRON_OFFSET * unit} y={middle} unit={unit} />}
            {segment.endsHere ? null : <Chevron x={lastOnLine + CHEVRON_OFFSET * unit} y={middle} unit={unit} />}
          </g>
        );
      })}
      {showLabel && labelSegment ? (
        <g className="loop-label" data-testid="loop-label">
          <rect
            x={(labelSegment.left + labelSegment.right) / 2 - (PILL_WIDTH * unit) / 2}
            y={labelSegment.system.top - (BAR_OVERHANG + TAB_HEIGHT / 2 + PILL_HEIGHT / 2) * unit}
            width={PILL_WIDTH * unit}
            height={PILL_HEIGHT * unit}
            rx={(PILL_HEIGHT / 2) * unit}
            strokeWidth={1.5 * unit}
          />
          <text
            x={(labelSegment.left + labelSegment.right) / 2}
            y={labelSegment.system.top - (BAR_OVERHANG + TAB_HEIGHT / 2) * unit}
            fontSize={13 * unit}
          >{loopLabel(region)}</text>
        </g>
      ) : null}
      {handles.map(({ handle, system, x }) => (
        <Handle
          key={handle}
          handle={handle}
          x={x}
          system={system}
          region={region}
          measureCount={measureCount}
          unit={unit}
          active={hover === handle || dragging === handle}
          dragging={dragging === handle}
          events={events}
        />
      ))}
    </svg>
  );
});
