import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { layoutNoteLabels, selectedGroupIds } from "./noteLabels";
import { playbackGroupIdsForPage } from "./playback";
import type { PlaybackCommand, PlaybackMoment } from "./playback";
import type { PlaybackMode, PlaybackStatus, RealtimePlayhead } from "./realtime";
import type { ListenModeFeedback } from "./noteRecognizer";
import { midiToPitchName } from "./piano";
import type {
  DocumentPage,
  ViewportTransform,
  VisualBBox,
  VisualGroup,
  VisualGroupRef,
  VisualPoint,
  VisualSidecar,
} from "./types";
import { isLinkedVisualGroup, isSelectableVisualGroup } from "./types";

const MIN_SCALE = 0.08;
const MAX_SCALE = 6;
const CLICK_MOVE_TOLERANCE = 6;
const PAGE_GAP = 28;
const PLAYBACK_EDGE_CLEARANCE = 16;
const MIN_TEMPO_PERCENTAGE = 10;
const MAX_TEMPO_PERCENTAGE = 300;
const MIN_VISIBLE_DOCUMENT_PX = 96;
const DEFAULT_VIEWPORT_TRANSFORM: ViewportTransform = { scale: 1, x: 24, y: 24 };
const NO_REALTIME_GROUPS: readonly string[] = [];

function FitWidthIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M7 12h10M7 12l2.5-2.5M7 12l2.5 2.5M17 12l-2.5-2.5M17 12l-2.5 2.5" />
    </svg>
  );
}

function FitPageIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8" y="5" width="8" height="14" rx="1" />
      <path d="M8 3.5H3.5V8M16 3.5h4.5V8M8 20.5H3.5V16M16 20.5h4.5V16" />
    </svg>
  );
}

function ResetZoomIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 9 7 7v10M16.5 9 19 7v10" />
      <path d="M12 10h.01M12 14h.01" className="toolbar-icon-dots" />
    </svg>
  );
}

export function validTempoPercentage(value: string): number | null {
  if (value.trim() === "") return null;
  const percentage = Number(value);
  return Number.isInteger(percentage) &&
    percentage >= MIN_TEMPO_PERCENTAGE &&
    percentage <= MAX_TEMPO_PERCENTAGE
    ? percentage
    : null;
}

export function committedTempoPercentage(value: string): number | null {
  if (value.trim() === "") return null;
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return null;
  return Math.min(
    MAX_TEMPO_PERCENTAGE,
    Math.max(MIN_TEMPO_PERCENTAGE, Math.round(percentage)),
  );
}

interface DocumentViewerProps {
  documentKey: string;
  pages: DocumentPage[];
  selectedGroup: VisualGroupRef | null;
  highlightAllNotes: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  showDiagnosticVisualGroups?: boolean;
  playbackActive: boolean;
  playbackNoteSoundsEnabled: boolean;
  playbackAvailable: boolean;
  playbackMoment: PlaybackMoment | null;
  playbackMode?: PlaybackMode;
  playbackStatus?: PlaybackStatus;
  realtimeAvailable?: boolean;
  realtimePlayhead?: RealtimePlayhead | null;
  getRealtimePlayhead?: () => RealtimePlayhead | null;
  realtimePlayheadAnimating?: boolean;
  realtimeGroupIdsByPage?: Readonly<Record<number, readonly string[]>>;
  tempoBpm?: number;
  tempoMultiplier?: number;
  listenFeedback: ListenModeFeedback;
  initialViewportTransform?: ViewportTransform;
  onViewportTransformChange?: (transform: ViewportTransform) => void;
  onPlaybackCommand: (command: PlaybackCommand) => void;
  onPlaybackModeChange?: (mode: PlaybackMode) => void;
  onTempoMultiplierChange?: (multiplier: number) => void;
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

function clampViewportOffset(offset: number, viewportSize: number, contentSize: number): number {
  if (viewportSize <= 0 || contentSize <= 0) return offset;
  const visibleSize = Math.min(MIN_VISIBLE_DOCUMENT_PX, viewportSize, contentSize);
  return Math.min(viewportSize - visibleSize, Math.max(visibleSize - contentSize, offset));
}

export function constrainViewportTransform(
  transform: ViewportTransform,
  viewportWidth: number,
  viewportHeight: number,
  documentWidth: number,
  documentHeight: number,
): ViewportTransform {
  return {
    ...transform,
    x: clampViewportOffset(transform.x, viewportWidth, documentWidth * transform.scale),
    y: clampViewportOffset(transform.y, viewportHeight, documentHeight * transform.scale),
  };
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

export function hitTest(
  sidecar: VisualSidecar,
  point: VisualPoint,
  includeDiagnosticGroups = false,
): VisualGroup | null {
  const eligibleGroups = sidecar.visual_groups.filter((group) =>
    isSelectableVisualGroup(group, includeDiagnosticGroups),
  );
  const noteheads = eligibleGroups.filter((group) => pointInNotehead(point, group));
  const candidates = noteheads.length
    ? noteheads
    : eligibleGroups.filter((group) => pointInBBox(point, group));
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

export function shouldScrollPlaybackHorizontally(
  momentLeft: number,
  momentRight: number,
  staffLeft: number,
  staffRight: number,
  safeLeft: number,
  safeRight: number,
  viewportWidth: number,
  edgeClearance = PLAYBACK_EDGE_CLEARANCE,
): boolean {
  const needsLeftwardReveal =
    momentLeft < safeLeft && Math.min(momentLeft, staffLeft) < edgeClearance;
  const needsRightwardReveal =
    momentRight > safeRight &&
    Math.max(momentRight, staffRight) > viewportWidth - edgeClearance;
  return needsLeftwardReveal || needsRightwardReveal;
}

export function centeredPlaybackX(
  momentLeft: number,
  momentRight: number,
  scale: number,
  viewportWidth: number,
): number {
  return viewportWidth / 2 - ((momentLeft + momentRight) / 2) * scale;
}

interface PageOverlayProps {
  page: DocumentPage;
  selected: VisualGroupRef | null;
  highlightAll: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  showDiagnosticVisualGroups: boolean;
  playbackActive: boolean;
  playbackGroupIds: readonly string[];
  realtimePlayhead?: RealtimePlayhead | null;
  realtimePlayheadEnabled?: boolean;
}

interface VisualGroupLayerProps {
  group: VisualGroup;
  selected: boolean;
  playback: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
}

const VisualGroupLayer = memo(function VisualGroupLayer({
  group,
  selected,
  playback,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
}: VisualGroupLayerProps) {
  const fittedNoteheads = (group.notehead_ellipses?.length ?? 0) > 0;
  return (
    <g
      className={`visual-group${selected ? " selected" : ""}${playback ? " playback-selected" : ""}`}
      data-visual-group-id={group.visual_group_id}
      data-visual-status={group.visual_status}
      data-playback-selected={playback ? "true" : undefined}
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
});

const PageOverlay = memo(function PageOverlay({
  page,
  selected,
  highlightAll,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
  showDiagnosticVisualGroups,
  playbackActive,
  playbackGroupIds,
  realtimePlayhead,
  realtimePlayheadEnabled = false,
}: PageOverlayProps) {
  const selectedIds = useMemo(
    () => {
      if (playbackActive) return new Set(playbackGroupIds);
      return page.visualSidecar
        ? selectedGroupIds(
            page.visualSidecar,
            selected,
            page.index,
            highlightAll,
            showDiagnosticVisualGroups,
          )
        : new Set<string>();
    },
    [
      highlightAll,
      page.index,
      page.visualSidecar,
      playbackActive,
      playbackGroupIds,
      selected,
      showDiagnosticVisualGroups,
    ],
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
  const visualGroupsById = useMemo(
    () => new Map(
      page.visualSidecar?.visual_groups
        .filter(isLinkedVisualGroup)
        .map((group) => [group.visual_group_id, group]) ?? [],
    ),
    [page.visualSidecar],
  );
  const visualSelectionKey = playbackActive ? "" : [...selectedIds].sort().join("\u0000");
  const visualGroupLayers = useMemo(() =>
    page.visualSidecar?.visual_groups
      .filter((group) => isSelectableVisualGroup(group, showDiagnosticVisualGroups))
      .map((group) => (
        <VisualGroupLayer
          key={group.visual_group_id}
          group={group}
          selected={!playbackActive && selectedIds.has(group.visual_group_id)}
          playback={false}
          showOriginalNoteheadContours={showOriginalNoteheadContours}
          showDetectedNoteheadContours={showDetectedNoteheadContours}
          showRefinedNoteheadContours={showRefinedNoteheadContours}
          showRawStemContours={showRawStemContours}
        />
      )) ?? [], [
      page.visualSidecar,
      playbackActive,
      showDetectedNoteheadContours,
      showOriginalNoteheadContours,
      showRawStemContours,
      showRefinedNoteheadContours,
      visualSelectionKey,
      showDiagnosticVisualGroups,
    ]);
  const playbackGroupLayers = useMemo(() => {
    if (!playbackActive) return [];
    return playbackGroupIds.flatMap((id) => {
      const group = visualGroupsById.get(id);
      return group ? [(
        <VisualGroupLayer
          key={`playback-${id}`}
          group={group}
          selected
          playback
          showOriginalNoteheadContours={showOriginalNoteheadContours}
          showDetectedNoteheadContours={showDetectedNoteheadContours}
          showRefinedNoteheadContours={showRefinedNoteheadContours}
          showRawStemContours={showRawStemContours}
        />
      )] : [];
    });
  }, [
    playbackActive,
    playbackGroupIds,
    showDetectedNoteheadContours,
    showOriginalNoteheadContours,
    showRawStemContours,
    showRefinedNoteheadContours,
    visualGroupsById,
  ]);
  if (!page.visualSidecar) return null;
  const sidecar = page.visualSidecar;
  return (
    <svg
      className={`overlay${playbackActive ? " playback-overlay" : ""}`}
      viewBox={`0 0 ${page.width} ${page.height}`}
      aria-hidden="true"
    >
      {realtimePlayheadEnabled || realtimePlayhead?.pageIndex === page.index ? (
        <line
          className="realtime-playhead"
          data-testid="realtime-playhead"
          data-realtime-page={page.index}
          x1={realtimePlayhead?.pageIndex === page.index ? realtimePlayhead.x : 0}
          x2={realtimePlayhead?.pageIndex === page.index ? realtimePlayhead.x : 0}
          y1={realtimePlayhead?.pageIndex === page.index ? realtimePlayhead.y1 : 0}
          y2={realtimePlayhead?.pageIndex === page.index ? realtimePlayhead.y2 : 0}
          style={{ display: realtimePlayhead?.pageIndex === page.index ? undefined : "none" }}
        />
      ) : null}
      {showRawStemContours
        ? sidecar.raw_stem_contours?.map((stem, index) => (
            <polyline
              key={`raw-stem-${stem.debug_id}-${index}`}
              className="raw-stem-contour"
              points={pointsToSvg(stem.contour)}
            />
          ))
        : null}
      {visualGroupLayers}
      {playbackGroupLayers}
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
  showDiagnosticVisualGroups = false,
  playbackActive,
  playbackNoteSoundsEnabled,
  playbackAvailable,
  playbackMoment,
  playbackMode = "note-by-note",
  playbackStatus,
  realtimeAvailable = false,
  realtimePlayhead = null,
  getRealtimePlayhead,
  realtimePlayheadAnimating = false,
  realtimeGroupIdsByPage,
  tempoBpm = 120,
  tempoMultiplier = 1,
  listenFeedback,
  initialViewportTransform,
  onViewportTransformChange,
  onPlaybackCommand,
  onPlaybackModeChange,
  onTempoMultiplierChange,
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
  const autoFitMarker = useRef<string | null>(initialViewportTransform ? `${documentKey}:restored` : null);
  const transformRef = useRef(initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM);
  const layoutRef = useRef({ width: 1, height: 1 });
  const pendingTransform = useRef<ViewportTransform | null>(null);
  const transformFrame = useRef<number | null>(null);
  const onViewportTransformChangeRef = useRef(onViewportTransformChange);
  onViewportTransformChangeRef.current = onViewportTransformChange;
  const [transform, setTransform] = useState<ViewportTransform>(
    initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM,
  );
  const [isPointerPanning, setIsPointerPanning] = useState(false);
  const [tempoPopoverOpen, setTempoPopoverOpen] = useState(false);
  const realtimeUnavailableTooltipId = useId();
  const tempoPercentage = Math.round(tempoMultiplier * 100);
  const [tempoPercentageText, setTempoPercentageText] = useState(String(tempoPercentage));
  const tempoInputFocused = useRef(false);
  const effectiveStatus: PlaybackStatus = playbackStatus ??
    (playbackActive ? "note-by-note" : "inactive");
  const effectivelyActive = effectiveStatus !== "inactive";
  const primaryLabel = effectiveStatus === "playing"
    ? "Pause"
    : effectiveStatus === "paused"
      ? "Resume"
      : effectiveStatus === "note-by-note"
        ? "Stop playback"
        : "Play";
  const primarySymbol = effectiveStatus === "playing"
    ? "Ⅱ"
    : effectiveStatus === "note-by-note"
      ? "■"
      : "▶";
  const pages = useMemo(
    () => documentPages.filter((page) => page.status !== "skipped"),
    [documentPages],
  );
  const firstSizedPage = pages.find(
    (page) => page.status === "loading" || page.status === "complete",
  );
  const displayPages = useMemo(
    () =>
      pages.map((page) => {
        const useKnownPageSize =
          firstSizedPage && page.status !== "loading" && page.status !== "complete";
        return {
          page,
          width: useKnownPageSize ? firstSizedPage.width : page.width,
          height: useKnownPageSize ? firstSizedPage.height : page.height,
        };
      }),
    [firstSizedPage, pages],
  );
  const listenActive = ["initializing", "listening", "paused"].includes(
    listenFeedback.lifecycle.state,
  );
  const listenStatus = useMemo(() => {
    const lifecycle = listenFeedback.lifecycle;
    if (lifecycle.state === "error") return `Listen error: ${lifecycle.error ?? "Unknown error"}`;
    if (lifecycle.state === "initializing") {
      const microphone = lifecycle.microphone === "ready" ? "Microphone ready" : "Requesting microphone";
      const analysis = lifecycle.analysis === "ready" ? "Analyzer ready" : "Starting analyzer";
      return `${microphone} · ${analysis}`;
    }
    if (lifecycle.state === "paused") return "Listening paused while the target chord plays";
    if (lifecycle.state !== "listening") return null;
    const target = listenFeedback.targetPitches.map(midiToPitchName).join(" ") || "no pitched notes";
    const heard = listenFeedback.detectedTargetPitches.map(midiToPitchName).join(" ");
    const extras = listenFeedback.extraPitches.map(midiToPitchName).join(" ");
    const targetSignals = listenFeedback.targetPitchConfidences
      .map(({ midi, confidence }) => `${midiToPitchName(midi)} ${Math.round(confidence * 100)}%`)
      .join(" ");
    const processing = listenFeedback.processingTimeMs === null
      ? ""
      : ` · ${Math.round(listenFeedback.processingTimeMs)} ms analysis`;
    return [
      `Microphone ready · Analyzer ready · Target ${target}`,
      heard ? `Heard ${heard}` : "Waiting for a fresh onset",
      extras ? `Extra ${extras}` : "",
      targetSignals ? `Signal ${targetSignals}` : "",
    ].filter(Boolean).join(" · ") + processing;
  }, [listenFeedback]);
  const hasCompletePageRef = useRef(pages.some((page) => page.status === "complete"));
  hasCompletePageRef.current = pages.some((page) => page.status === "complete");

  useEffect(() => {
    if (!tempoPopoverOpen) return;
    function closeTempoPopover(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setTempoPopoverOpen(false);
    }
    window.addEventListener("keydown", closeTempoPopover, true);
    return () => window.removeEventListener("keydown", closeTempoPopover, true);
  }, [tempoPopoverOpen]);

  useEffect(() => {
    if (playbackMode !== "realtime") setTempoPopoverOpen(false);
  }, [playbackMode]);

  useEffect(() => {
    if (!tempoInputFocused.current || !tempoPopoverOpen) {
      setTempoPercentageText(String(tempoPercentage));
    }
  }, [tempoPercentage, tempoPopoverOpen]);

  function commitTempoInput(): void {
    const percentage = committedTempoPercentage(tempoPercentageText);
    if (percentage === null) {
      setTempoPercentageText(String(tempoPercentage));
      return;
    }
    setTempoPercentageText(String(percentage));
    onTempoMultiplierChange?.(percentage / 100);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !getRealtimePlayhead) return;
    const lines = new Map<number, SVGLineElement>();
    for (const line of Array.from(stage.querySelectorAll<SVGLineElement>(".realtime-playhead"))) {
      const pageIndex = Number(line.dataset.realtimePage);
      if (Number.isInteger(pageIndex)) lines.set(pageIndex, line);
    }
    let animationFrame: number | null = null;
    let visibleLine: SVGLineElement | null = null;
    let visibleSystem = "";

    const updatePlayhead = () => {
      const playhead = getRealtimePlayhead();
      const line = playhead ? lines.get(playhead.pageIndex) ?? null : null;
      if (line !== visibleLine) {
        if (visibleLine) visibleLine.style.display = "none";
        visibleLine = line;
        visibleSystem = "";
        if (visibleLine) visibleLine.style.display = "";
      }
      if (line && playhead) {
        const system = `${playhead.y1}:${playhead.y2}`;
        if (system !== visibleSystem) {
          line.setAttribute("y1", String(playhead.y1));
          line.setAttribute("y2", String(playhead.y2));
          visibleSystem = system;
        }
        line.style.transform = `translate3d(${playhead.x}px, 0, 0)`;
      }
    };
    const animate = () => {
      updatePlayhead();
      animationFrame = requestAnimationFrame(animate);
    };

    updatePlayhead();
    if (realtimePlayheadAnimating) animationFrame = requestAnimationFrame(animate);
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (visibleLine) visibleLine.style.display = "none";
    };
  }, [documentKey, getRealtimePlayhead, pages, realtimePlayheadAnimating]);

  function publishTransform(next: ViewportTransform) {
    if (hasCompletePageRef.current) onViewportTransformChangeRef.current?.(next);
  }

  function constrainTransform(next: ViewportTransform): ViewportTransform {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return next;
    return constrainViewportTransform(
      next,
      rect.width,
      rect.height,
      layoutRef.current.width,
      layoutRef.current.height,
    );
  }

  function commitTransform(next: ViewportTransform) {
    if (transformFrame.current !== null) cancelAnimationFrame(transformFrame.current);
    transformFrame.current = null;
    pendingTransform.current = null;
    const constrained = constrainTransform(next);
    transformRef.current = constrained;
    setTransform(constrained);
    publishTransform(constrained);
  }

  function scheduleTransform(update: (current: ViewportTransform) => ViewportTransform) {
    const current = pendingTransform.current ?? transformRef.current;
    pendingTransform.current = constrainTransform(update(current));
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
      width: Math.max(1, ...displayPages.map((displayPage) => displayPage.width)),
      height:
        displayPages.reduce((total, displayPage) => total + displayPage.height, 0) +
        PAGE_GAP * Math.max(0, displayPages.length - 1),
    }),
    [displayPages],
  );
  layoutRef.current = layout;
  const firstRealPage = pages.find((page) => page.status === "complete");
  const autoFitPhase = firstRealPage
    ? `${documentKey}:complete`
    : `${documentKey}:loading:${layout.width}:${layout.height}`;

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
    autoFitMarker.current = initialViewportTransform ? `${documentKey}:restored` : null;
    setIsPointerPanning(false);
    commitTransform(initialViewportTransform ?? DEFAULT_VIEWPORT_TRANSFORM);
  }, [documentKey]);

  useEffect(() => {
    if (initialViewportTransform || pages.length === 0 || autoFitMarker.current === autoFitPhase) return;
    autoFitMarker.current = autoFitPhase;
    fitWidth();
  }, [autoFitPhase, initialViewportTransform, pages.length]);

  function fitPage() {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || pages.length === 0) return;
    const page =
      pages.find((candidate) => candidate.index === selectedGroup?.pageIndex) ?? firstRealPage ?? pages[0];
    const displayPage = displayPages.find((candidate) => candidate.page.index === page.index);
    if (!displayPage) return;
    const pagePosition = displayPages.indexOf(displayPage);
    const pageTop = displayPages
      .slice(0, pagePosition)
      .reduce((total, candidate) => total + candidate.height + PAGE_GAP, 0);
    const scale = clampScale(
      Math.min((rect.width - 64) / displayPage.width, (rect.height - 64) / displayPage.height),
    );
    commitTransform({
      scale,
      x: (rect.width - layout.width * scale) / 2,
      y: (rect.height - displayPage.height * scale) / 2 - pageTop * scale,
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
      const group = hitTest(
        page.visualSidecar,
        point,
        showDiagnosticVisualGroups,
      );
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
      (group) =>
        group.staff_index === playbackMoment.staffIndex &&
        isLinkedVisualGroup(group),
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
    const momentLabels = layoutNoteLabels(
      sidecar,
      momentIds,
      page.width,
      page.height,
      page.musicXml,
    );
    const verticalPadding = Math.max(18, page.height * 0.018);
    const horizontalPadding = Math.max(18, page.width * 0.02);
    const staffTop = pageTop + Math.min(...staffBoxes.map((box) => box[1])) - verticalPadding;
    const staffBottom = pageTop + Math.max(...staffBoxes.map((box) => box[3])) + verticalPadding;
    const staffLeft = pageLeft + Math.min(...staffBoxes.map((box) => box[0])) - horizontalPadding;
    const staffRight = pageLeft + Math.max(...staffBoxes.map((box) => box[2])) + horizontalPadding;
    const momentLeft = pageLeft + Math.min(...momentBoxes.map((box) => box[0]));
    const momentRight = pageLeft + Math.max(...momentBoxes.map((box) => box[2]));
    const momentContentLeft = pageLeft + Math.min(
      ...momentBoxes.map((box) => box[0]),
      ...momentLabels.map((label) => label.x),
    );
    const momentContentRight = pageLeft + Math.max(
      ...momentBoxes.map((box) => box[2]),
      ...momentLabels.map((label) => label.x + label.width),
    );
    const current = transformRef.current;
    const safeTop = rect.height * 0.12;
    const keyboardHeight = Math.min(210, Math.max(150, window.innerHeight * 0.24));
    const safeBottom = Math.max(safeTop + 80, rect.height - keyboardHeight - 20);
    const safeLeft = rect.width * 0.12;
    const safeRight = rect.width * 0.88;
    const screenStaffTop = current.y + staffTop * current.scale;
    const screenStaffBottom = current.y + staffBottom * current.scale;
    const screenStaffLeft = current.x + staffLeft * current.scale;
    const screenStaffRight = current.x + staffRight * current.scale;
    const screenMomentLeft = current.x + momentContentLeft * current.scale;
    const screenMomentRight = current.x + momentContentRight * current.scale;
    let x = current.x;
    let y = current.y;

    if (screenStaffTop < safeTop || screenStaffBottom > safeBottom) {
      const documentCenter = (staffTop + staffBottom) / 2;
      y = (safeTop + safeBottom) / 2 - documentCenter * current.scale;
    }
    if (shouldScrollPlaybackHorizontally(
      screenMomentLeft,
      screenMomentRight,
      screenStaffLeft,
      screenStaffRight,
      safeLeft,
      safeRight,
      rect.width,
    )) {
      x = centeredPlaybackX(momentLeft, momentRight, current.scale, rect.width);
    }
    if (Math.abs(x - current.x) > 0.5 || Math.abs(y - current.y) > 0.5) {
      commitTransform({ ...current, x, y });
    }
  }, [layout.width, pages, playbackActive, playbackMoment]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button
          type="button"
          className="viewport-action"
          aria-label="Fit width"
          title="Fit width"
          onClick={fitWidth}
        >
          <FitWidthIcon />
        </button>
        <button
          type="button"
          className="viewport-action"
          aria-label="Fit page"
          title="Fit page"
          onClick={fitPage}
        >
          <FitPageIcon />
        </button>
        <button
          type="button"
          className="viewport-action"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100%"
          onClick={() => commitTransform(DEFAULT_VIEWPORT_TRANSFORM)}
        >
          <ResetZoomIcon />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            const current = transformRef.current;
            commitTransform({ ...current, scale: clampScale(current.scale / 1.2) });
          }}
        >−</button>
        <span>{Math.round(transform.scale * 100)}%</span>
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
          {onPlaybackModeChange ? <div className="playback-mode-selector" role="group" aria-label="Playback type">
            <button
              type="button"
              className={playbackMode === "note-by-note" ? "selected" : ""}
              aria-pressed={playbackMode === "note-by-note"}
              onClick={() => onPlaybackModeChange?.("note-by-note")}
            >Note-by-note</button>
            <div className={`realtime-mode-control${realtimeAvailable ? "" : " unavailable"}`}>
              <button
                type="button"
                className={playbackMode === "realtime" ? "selected" : ""}
                aria-pressed={playbackMode === "realtime"}
                aria-describedby={!realtimeAvailable ? realtimeUnavailableTooltipId : undefined}
                title={realtimeAvailable ? "Use audio-clock playback" : undefined}
                disabled={!realtimeAvailable}
                onClick={() => onPlaybackModeChange?.("realtime")}
              >Realtime</button>
              {!realtimeAvailable ? (
                <div
                  id={realtimeUnavailableTooltipId}
                  className="realtime-unavailable-tooltip"
                  role="tooltip"
                >Realtime is not available until all pages are ready.</div>
              ) : null}
            </div>
          </div> : null}
          <button
            type="button"
            className={`playback-toggle${effectivelyActive ? " active" : ""}`}
            aria-label={primaryLabel}
            aria-pressed={effectivelyActive}
            title={`${primaryLabel} (Space)`}
            disabled={effectiveStatus === "inactive" && (
              playbackMode === "realtime" ? !realtimeAvailable : !playbackAvailable
            )}
            onClick={() => onPlaybackCommand("togglePlayback")}
          >{primarySymbol}</button>
          {playbackMode === "realtime" && effectivelyActive ? (
            <button
              type="button"
              className="realtime-stop"
              aria-label="Stop playback"
              title="Stop playback (Escape)"
              onClick={() => onPlaybackCommand("stopPlayback")}
            >■</button>
          ) : null}
          <button
            type="button"
            className={`sound-toggle${playbackNoteSoundsEnabled ? " active" : ""}`}
            aria-label={playbackNoteSoundsEnabled ? "Mute note sounds" : "Play note sounds"}
            aria-pressed={playbackNoteSoundsEnabled}
            title={playbackNoteSoundsEnabled ? "Mute note sounds (M)" : "Play note sounds (M)"}
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("toggleNoteSounds")}
          >{playbackNoteSoundsEnabled ? "🔊" : "🔇"}</button>
          <button
            type="button"
            className={`listen-toggle${listenActive ? " active" : ""}`}
            aria-label={listenActive ? "Disable listen mode" : "Enable listen mode"}
            aria-pressed={listenActive}
            title={listenActive ? "Disable listen mode (L)" : "Listen and advance when the chord is played (L)"}
            disabled={playbackMode !== "note-by-note" || !playbackActive}
            onClick={() => onPlaybackCommand("toggleListenMode")}
          >🎙</button>
          <button
            type="button"
            className="audition-button"
            aria-label="Play current notes"
            title="Play the current note or chord (P)"
            disabled={
              playbackMode !== "note-by-note" ||
              !playbackActive ||
              (playbackMoment?.pitches.length ?? 0) === 0
            }
            onClick={() => onPlaybackCommand("playCurrentNotes")}
          >♬</button>
          <button
            type="button"
            aria-label="Backward one page"
            title="Backward one page (Up arrow)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("backwardPage")}
          >⇤</button>
          <button
            type="button"
            aria-label="Backward one bar"
            title="Backward one bar (Comma)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("backwardBar")}
          >←│</button>
          <button
            type="button"
            aria-label="Backward one note"
            title="Backward one note (Left arrow)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("backwardNote")}
          >←</button>
          <button
            type="button"
            aria-label="Forward one note"
            title="Forward one note (Right arrow)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("forwardNote")}
          >→</button>
          <button
            type="button"
            aria-label="Forward one bar"
            title="Forward one bar (Period)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("forwardBar")}
          >│→</button>
          <button
            type="button"
            aria-label="Forward one page"
            title="Forward one page (Down arrow)"
            disabled={!effectivelyActive}
            onClick={() => onPlaybackCommand("forwardPage")}
          >⇥</button>
          {playbackMode === "realtime" ? (
            <div className="tempo-control">
              <button
                type="button"
                className="tempo-button"
                aria-label={`Tempo ${Math.round(tempoBpm)} BPM`}
                aria-expanded={tempoPopoverOpen}
                onClick={() => setTempoPopoverOpen((open) => !open)}
              >{Math.round(tempoBpm)} BPM</button>
              {tempoPopoverOpen ? (
                <div className="tempo-popover" role="dialog" aria-label="Realtime tempo">
                  <label>
                    Tempo
                    <span>
                      <input
                        type="number"
                        min={10}
                        max={300}
                        step={1}
                        aria-label="Tempo percentage"
                        value={tempoPercentageText}
                        onFocus={() => {
                          tempoInputFocused.current = true;
                        }}
                        onBlur={() => {
                          tempoInputFocused.current = false;
                          commitTempoInput();
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          event.currentTarget.blur();
                        }}
                        onChange={(event) => {
                          const value = event.target.value;
                          setTempoPercentageText(value);
                          const percentage = validTempoPercentage(value);
                          if (percentage !== null) onTempoMultiplierChange?.(percentage / 100);
                        }}
                      />%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={300}
                    step={1}
                    aria-label="Tempo percentage slider"
                    value={tempoPercentage}
                    onChange={(event) => {
                      const percentage = Number(event.target.value);
                      setTempoPercentageText(String(percentage));
                      onTempoMultiplierChange?.(percentage / 100);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {listenStatus ? (
          <span
            className={`listen-status listen-status-${listenFeedback.lifecycle.state}`}
            role={listenFeedback.lifecycle.state === "error" ? "alert" : "status"}
            title={listenStatus}
          >{listenStatus}</span>
        ) : null}
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
          {displayPages.map(({ page, width, height }, pagePosition) => (
            <div
              key={page.index}
              ref={(element) => {
                if (element) pageRefs.current.set(page.index, element);
                else pageRefs.current.delete(page.index);
              }}
              className={`document-page page-${page.status}`}
              style={{ width, height, marginBottom: pagePosition === displayPages.length - 1 ? 0 : PAGE_GAP }}
            >
              <span className="page-number">{page.index + 1}</span>
              {page.imageUrl ? <img src={page.imageUrl} alt={`Sheet music page ${page.index + 1}`} draggable={false} /> : null}
              <PageOverlay
                page={page}
                selected={selectedGroup}
                highlightAll={highlightAllNotes}
                playbackActive={playbackActive}
                playbackGroupIds={
                  realtimeGroupIdsByPage
                    ? realtimeGroupIdsByPage[page.index] ?? NO_REALTIME_GROUPS
                    : playbackGroupIdsForPage(playbackMoment, page.index)
                }
                realtimePlayhead={realtimePlayhead}
                realtimePlayheadEnabled={Boolean(getRealtimePlayhead)}
                showOriginalNoteheadContours={showOriginalNoteheadContours}
                showDetectedNoteheadContours={showDetectedNoteheadContours}
                showRefinedNoteheadContours={showRefinedNoteheadContours}
                showRawStemContours={showRawStemContours}
                showDiagnosticVisualGroups={showDiagnosticVisualGroups}
              />
              {page.status !== "complete" ? (
                <div className="page-placeholder">
                  {page.status === "failed" ? (
                    <div
                      className="page-placeholder-content failed"
                      role="alert"
                      style={{ transform: `scale(${1 / transform.scale})` }}
                    >
                        <strong>Page {page.index + 1} failed</strong>
                        <span>{page.error}</span>
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => onRetryPage(page.index)}
                        >Retry page</button>
                    </div>
                  ) : (
                    <div
                      className="page-placeholder-content loading"
                      role="status"
                      style={{ transform: `scale(${1 / transform.scale})` }}
                    >
                      <span
                        className={page.status === "processing" ? "spinner" : "page-pending-dot"}
                        aria-hidden="true"
                      />
                      <span className="page-loading-copy">
                        <strong>
                          {page.status === "loading"
                            ? `Preparing page ${page.index + 1}`
                            : page.status === "processing"
                              ? `Recognizing page ${page.index + 1}`
                              : `Page ${page.index + 1} is queued`}
                        </strong>
                        <span>
                          {page.status === "loading"
                            ? "Loading the recognized score…"
                            : page.status === "processing"
                              ? "Reading notation and building MusicXML…"
                              : "Waiting for recognition to begin…"}
                        </span>
                      </span>
                    </div>
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
