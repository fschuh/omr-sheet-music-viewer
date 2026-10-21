import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { layoutNoteLabels } from "./noteLabels";
import {
  hitTestNoteheads,
  noteGeometryByPage,
  selectedNoteheadIds,
  type Bounds,
  type NoteheadGeometry,
  type PageNoteGeometry,
} from "./noteGeometry";
import { diagnosticNoteheads } from "./sidecarNoteGeometry";
import { MusicXmlPageSurface, type MusicXmlPage } from "./musicxml";
import { playbackGroupIdsForPage } from "./playback";
import { valueMismatchGroupIds } from "./noteValues";
import { restGlyph } from "./restGlyphs";
import type { PlaybackCommand, PlaybackMoment, PracticeHand } from "./playback";
import type { PlaybackMode, PlaybackStatus, RealtimePlayhead } from "./realtime";
import type { ListenModeFeedback } from "./noteRecognizer";
import { NOTE_HIGHWAY_TOP_FRACTION } from "./noteHighway/highwayModel";
import { midiToPitchName } from "./piano";
import {
  draggedLoopRegion,
  loopBoundaryPlacement,
  loopMeasureCount,
  loopSegments,
  loopSystems,
  moveLoopHandleTo,
  type LoopHandle,
  type LoopRegion,
  type ScreenLoopSystem,
} from "./loop";
import { LOOP_HANDLE_REACH, LoopPageLayer, LoopPageTint, type LoopHandleEvents } from "./LoopOverlay";
import type {
  DocumentPage,
  ViewportTransform,
  VisualGroup,
  VisualGroupRef,
  VisualPoint,
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
/** In keyboard order, left to right. */
const PRACTICE_HAND_OPTIONS: ReadonlyArray<{
  hand: PracticeHand;
  label: string;
  description: string;
  shortcut?: string;
}> = [
  { hand: "left", label: "LH", description: "Practice the left hand", shortcut: "[" },
  { hand: "both", label: "Both", description: "Play both hands" },
  { hand: "right", label: "RH", description: "Practice the right hand", shortcut: "]" },
];
const NO_GROUP_IDS: ReadonlySet<string> = new Set();

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

function LoopIcon() {
  return (
    <svg className="toolbar-icon loop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17 4.5 19.5 7 17 9.5" />
      <path d="M4.5 11.5V10a3 3 0 0 1 3-3h12" />
      <path d="M7 19.5 4.5 17 7 14.5" />
      <path d="M19.5 12.5V14a3 3 0 0 1-3 3h-12" />
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

/** How long a tempo shortcut is held at one percentage point a step before it speeds up, in milliseconds. */
const TEMPO_RAMP_START_MS = 1000;
/** How long each further percentage point of a held tempo shortcut's step takes, in milliseconds. */
const TEMPO_RAMP_STEP_MS = 500;
/** The largest step of a held tempo shortcut, in percentage points. */
const TEMPO_RAMP_MAX_STEP = 3;

/**
 * How many percentage points a tempo shortcut held for `heldMs` steps the tempo: one at
 * first, so short holds stay precise, then one more every half second up to three.
 */
export function heldTempoStep(heldMs: number): number {
  if (heldMs < TEMPO_RAMP_START_MS) return 1;
  return Math.min(TEMPO_RAMP_MAX_STEP, 2 + Math.floor((heldMs - TEMPO_RAMP_START_MS) / TEMPO_RAMP_STEP_MS));
}

/** The tempo multiplier `step` percentage points from `multiplier`, kept in range. */
export function steppedTempoMultiplier(multiplier: number, step: number): number {
  const percentage = Math.round(multiplier * 100) + step;
  return Math.min(MAX_TEMPO_PERCENTAGE, Math.max(MIN_TEMPO_PERCENTAGE, percentage)) / 100;
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
  /** Note geometry of every page with music, whatever its source. */
  noteGeometry: readonly PageNoteGeometry[];
  selectedGroup: VisualGroupRef | null;
  highlightAllNotes: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  showDiagnosticVisualGroups?: boolean;
  /** Draw ghosts of the rests that have no rest-shaped ink on the page. */
  showUnsupportedRests?: boolean;
  /** Halo the notes whose printed value disagrees with the recognized one. */
  showValueMismatches?: boolean;
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
  /** The hand being practised; the hand controls are hidden without onPracticeHandChange. */
  practiceHand?: PracticeHand;
  /** Sound switches for the practised and the other hand, used while one hand is practised. */
  practicedHandSoundEnabled?: boolean;
  otherHandSoundEnabled?: boolean;
  /** The 3D note highway preference, shared by both playback modes. */
  noteHighwayEnabled?: boolean;
  /** The highway is on screen, so playback scrolling keeps the staff above it. */
  noteHighwayVisible?: boolean;
  listenFeedback: ListenModeFeedback;
  /** Loop mode is on; the Loop button is hidden without onLoopToggle. */
  loopMode?: boolean;
  /** The loop drawn on the score, while loop mode is on during playback. */
  loop?: LoopRegion | null;
  /** The repetition being played, from 1. */
  loopPass?: number;
  /** Playback is inside the loop, so the button shows the pass. */
  loopPlaying?: boolean;
  /** Dim the bars outside the loop. */
  loopDimOutside?: boolean;
  onLoopToggle?: () => void;
  /** A handle was moved to another barline, by dragging or with the arrow keys. */
  onLoopChange?: (region: LoopRegion) => void;
  /** A loop handle was picked up, or dropped. */
  onLoopDragChange?: (dragging: boolean) => void;
  initialViewportTransform?: ViewportTransform;
  onViewportTransformChange?: (transform: ViewportTransform) => void;
  onPlaybackCommand: (command: PlaybackCommand) => void;
  onPlaybackModeChange?: (mode: PlaybackMode) => void;
  onTempoMultiplierChange?: (multiplier: number) => void;
  onNoteHighwayToggle?: () => void;
  onPracticeHandChange?: (hand: PracticeHand) => void;
  onPracticedHandSoundChange?: (enabled: boolean) => void;
  onOtherHandSoundChange?: (enabled: boolean) => void;
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

function pointerDistance(first: PointerState, second: PointerState): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: PointerState, second: PointerState): VisualPoint {
  return [(first.x + second.x) / 2, (first.y + second.y) / 2];
}

function pointsToSvg(points: VisualPoint[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Diagnostic visual groups of a PDF page, while Diagnostics shows them. */
export function pageDiagnosticNoteheads(
  page: DocumentPage,
  showDiagnosticVisualGroups: boolean,
): NoteheadGeometry[] {
  return showDiagnosticVisualGroups && page.visualSidecar
    ? diagnosticNoteheads(page.visualSidecar)
    : [];
}

/**
 * The noteheads a page highlights: during playback, the ones sounding; otherwise the
 * selection, with its chord, or every notehead when all are highlighted.
 */
export function pageHighlightIds(
  geometry: PageNoteGeometry | undefined,
  selected: VisualGroupRef | null,
  pageIndex: number,
  highlightAll: boolean,
  diagnostics: readonly NoteheadGeometry[],
  playbackActive: boolean,
  playbackGroupIds: readonly string[],
): Set<string> {
  if (playbackActive) return new Set(playbackGroupIds);
  return selectedNoteheadIds(geometry, selected, pageIndex, highlightAll, diagnostics);
}

/**
 * The notehead a click at `point` selects. Diagnostic groups shown by Diagnostics are
 * candidates too, and win where they overlap notes, since they are shown to be inspected.
 */
export function noteheadAt(
  geometry: PageNoteGeometry,
  diagnostics: readonly NoteheadGeometry[],
  point: VisualPoint,
): NoteheadGeometry | null {
  return hitTestNoteheads(
    [...geometry.noteheads, ...diagnostics],
    point,
    diagnostics.length ? new Set(diagnostics.map((notehead) => notehead.id)) : undefined,
  );
}

export interface PlaybackMomentExtents {
  /** Every notehead of the moment's system, in page pixels. */
  system: Bounds;
  momentLeft: number;
  momentRight: number;
  /** The moment's noteheads together with their pitch labels. */
  contentLeft: number;
  contentRight: number;
}

export function playbackMomentExtents(
  geometry: PageNoteGeometry | undefined,
  page: Pick<DocumentPage, "width" | "height">,
  moment: PlaybackMoment,
): PlaybackMomentExtents | null {
  if (!geometry) return null;
  const systemNoteheads = geometry.noteheads.filter(
    (notehead) => notehead.systemIndex === moment.staffGroupIndex,
  );
  const momentIds = new Set(moment.visualGroupIds);
  const momentNoteheads = systemNoteheads.filter((notehead) => momentIds.has(notehead.id));
  if (systemNoteheads.length === 0 || momentNoteheads.length === 0) return null;

  const systemBoxes = systemNoteheads.map((notehead) => notehead.bounds);
  const momentBoxes = momentNoteheads.map((notehead) => notehead.bounds);
  const momentLabels = layoutNoteLabels(geometry, momentIds, page.width, page.height);
  return {
    system: [
      Math.min(...systemBoxes.map((box) => box[0])),
      Math.min(...systemBoxes.map((box) => box[1])),
      Math.max(...systemBoxes.map((box) => box[2])),
      Math.max(...systemBoxes.map((box) => box[3])),
    ],
    momentLeft: Math.min(...momentBoxes.map((box) => box[0])),
    momentRight: Math.max(...momentBoxes.map((box) => box[2])),
    contentLeft: Math.min(
      ...momentBoxes.map((box) => box[0]),
      ...momentLabels.map((label) => label.x),
    ),
    contentRight: Math.max(
      ...momentBoxes.map((box) => box[2]),
      ...momentLabels.map((label) => label.x + label.width),
    ),
  };
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

/** How close to an edge of the view a dragged loop handle starts scrolling, in screen pixels. */
const LOOP_EDGE_ZONE = 48;
/** The fastest a dragged loop handle scrolls the view, in screen pixels per frame. */
const LOOP_EDGE_MAX_SPEED = 18;
/**
 * How long realtime playback leaves the view where a moved loop end put it before
 * following the playhead again, in milliseconds.
 */
const LOOP_EDIT_FOLLOW_HOLD_MS = 500;
/** How far past the document's edge a loop handle may scroll, and the room kept around one it reveals, in screen pixels. */
const LOOP_SCROLL_PADDING = 32;

/**
 * One frame of scrolling along one axis while a loop handle is dragged at `pointer`: the
 * nearer an edge of the view [start, end] it is, the faster the document moves to show
 * what lies past that edge, as long as the document [contentStart, contentEnd] reaches
 * past it. Positive moves the document down or right, showing what lies above or left.
 * It scrolls only toward the edge the pointer last travelled toward, its `heading`
 * (negative toward start, positive toward end), so dragging away from an edge never
 * scrolls toward it.
 */
export function loopEdgeScrollStep(
  pointer: number,
  start: number,
  end: number,
  contentStart: number,
  contentEnd: number,
  heading: number,
): number {
  const zone = Math.min(LOOP_EDGE_ZONE, (end - start) / 4);
  if (zone <= 0) return 0;
  if (heading < 0 && pointer < start + zone && contentStart < start) {
    const depth = Math.min(1, (start + zone - pointer) / zone);
    return Math.min(start - contentStart, Math.ceil(depth * LOOP_EDGE_MAX_SPEED));
  }
  if (heading > 0 && pointer > end - zone && contentEnd > end) {
    const depth = Math.min(1, (pointer - (end - zone)) / zone);
    return -Math.min(contentEnd - end, Math.ceil(depth * LOOP_EDGE_MAX_SPEED));
  }
  return 0;
}

/**
 * How far, in screen pixels, a dragged loop handle's pointer must turn back before it
 * counts as heading the other way, so a hand settling or a cursor held against the
 * screen's edge does not stop the scrolling.
 */
const LOOP_HEADING_TOLERANCE = 6;

/** Which way a dragged handle's pointer is heading along one axis, and how far it got that way. */
export interface LoopHeading {
  /** -1 toward the start, 1 toward the end, 0 before it has gone either way. */
  heading: number;
  /** Where the pointer turned or furthest went in the heading. */
  turn: number;
}

/** The heading after the pointer moved to `position`. */
export function nextLoopHeading(previous: LoopHeading, position: number): LoopHeading {
  const { heading, turn } = previous;
  if (heading !== 0 && (position - turn) * heading >= 0) {
    return position === turn ? previous : { heading, turn: position };
  }
  if (Math.abs(position - turn) <= LOOP_HEADING_TOLERANCE) return previous;
  return { heading: Math.sign(position - turn), turn: position };
}

/**
 * A frame's scroll `step` along one axis, cut short once the furthest a dragged handle can
 * go, [low, high] on screen, is inside the view [start, end]: the start handle stops a
 * measure before the end handle, so the view scrolls no further toward the end than to
 * show that, and likewise the end handle toward the start.
 */
export function loopScrollStepWithinReach(
  step: number,
  handle: LoopHandle,
  low: number,
  high: number,
  start: number,
  end: number,
): number {
  if (handle === "start" && step < 0) return Math.max(step, Math.min(0, end - high));
  if (handle === "end" && step > 0) return Math.min(step, Math.max(0, start - low));
  return step;
}

/**
 * How far to move the document along one axis so [low, high] lies inside [start, end],
 * keeping its start in view when it does not fit.
 */
export function revealOffset(low: number, high: number, start: number, end: number): number {
  if (low < start || high - low > end - start) return start - low;
  if (high > end) return end - high;
  return 0;
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
  geometry: PageNoteGeometry | undefined;
  selected: VisualGroupRef | null;
  highlightAll: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
  showDiagnosticVisualGroups: boolean;
  showUnsupportedRests: boolean;
  showValueMismatches: boolean;
  playbackActive: boolean;
  playbackGroupIds: readonly string[];
  realtimePlayhead?: RealtimePlayhead | null;
  realtimePlayheadEnabled?: boolean;
}

interface VisualGroupLayerProps {
  group: VisualGroup;
  selected: boolean;
  playback: boolean;
  /** The page prints a different value than was recognized for this note. */
  valueMismatch?: boolean;
  showOriginalNoteheadContours: boolean;
  showDetectedNoteheadContours: boolean;
  showRefinedNoteheadContours: boolean;
  showRawStemContours: boolean;
}

const VisualGroupLayer = memo(function VisualGroupLayer({
  group,
  selected,
  playback,
  valueMismatch = false,
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
      data-diagnostic-highlight={
        group.visual_status === "diagnostic" || valueMismatch ? "halo" : undefined
      }
      data-value-mismatch={valueMismatch ? "true" : undefined}
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
  geometry,
  selected,
  highlightAll,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
  showDiagnosticVisualGroups,
  showUnsupportedRests,
  showValueMismatches,
  playbackActive,
  playbackGroupIds,
  realtimePlayhead,
  realtimePlayheadEnabled = false,
}: PageOverlayProps) {
  const diagnosticGroups = useMemo(
    () => pageDiagnosticNoteheads(page, showDiagnosticVisualGroups),
    [page, showDiagnosticVisualGroups],
  );
  const valueMismatchIds = useMemo(
    () =>
      showValueMismatches && page.visualSidecar
        ? valueMismatchGroupIds(page.visualSidecar)
        : NO_GROUP_IDS,
    [page.visualSidecar, showValueMismatches],
  );
  const ghostRests = useMemo(
    () =>
      showUnsupportedRests
        ? (page.visualSidecar?.rest_verification?.rests ?? [])
            .filter((rest) => rest.status === "unsupported")
            .flatMap((rest) => {
              const glyph = restGlyph(rest);
              return glyph ? [{ rest, glyph }] : [];
            })
        : [],
    [page.visualSidecar, showUnsupportedRests],
  );
  const selectedIds = useMemo(
    () => pageHighlightIds(
      geometry,
      selected,
      page.index,
      highlightAll,
      diagnosticGroups,
      playbackActive,
      playbackGroupIds,
    ),
    [
      diagnosticGroups,
      geometry,
      highlightAll,
      page.index,
      playbackActive,
      playbackGroupIds,
      selected,
    ],
  );
  const noteLabels = useMemo(
    () =>
      geometry
        ? layoutNoteLabels(geometry, selectedIds, page.width, page.height)
        : [],
    [geometry, page.height, page.width, selectedIds],
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
      .sort(
        (first, second) =>
          Number(first.visual_status === "diagnostic") -
          Number(second.visual_status === "diagnostic"),
      )
      .map((group) => (
        <VisualGroupLayer
          key={group.visual_group_id}
          group={group}
          selected={!playbackActive && selectedIds.has(group.visual_group_id)}
          playback={false}
          valueMismatch={valueMismatchIds.has(group.visual_group_id)}
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
      valueMismatchIds,
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
  // Pages without note geometry or a sidecar have nothing to overlay.
  if (!page.visualSidecar && !geometry) return null;
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
      {showRawStemContours && sidecar
        ? sidecar.raw_stem_contours?.map((stem, index) => (
            <polyline
              key={`raw-stem-${stem.debug_id}-${index}`}
              className="raw-stem-contour"
              points={pointsToSvg(stem.contour)}
            />
          ))
        : null}
      {visualGroupLayers}
      {ghostRests.length > 0 ? (
        <g className="ghost-rests">
          {ghostRests.map(({ rest, glyph }) => (
            <g
              key={rest.rest_id}
              className={`ghost-rest${rest.position_estimated ? " estimated" : ""}`}
              data-rest-id={rest.rest_id}
              data-rest-reason={rest.reason}
              data-rest-kind={glyph.kind}
            >
              {glyph.fills ? <path className="ghost-rest-fill" d={glyph.fills} /> : null}
              {glyph.strokes ? <path className="ghost-rest-stroke" d={glyph.strokes} /> : null}
            </g>
          ))}
        </g>
      ) : null}
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

/** An engraved MusicXML page, coloured where the overlay would highlight a PDF page. */
const EngravedPage = memo(function EngravedPage({
  surface,
  geometry,
  selected,
  highlightAll,
  playbackActive,
  playbackGroupIds,
}: {
  surface: MusicXmlPage;
  geometry: PageNoteGeometry | undefined;
  selected: VisualGroupRef | null;
  highlightAll: boolean;
  playbackActive: boolean;
  playbackGroupIds: readonly string[];
}) {
  const highlighted = useMemo(
    () => pageHighlightIds(geometry, selected, surface.index, highlightAll, [], playbackActive, playbackGroupIds),
    [geometry, highlightAll, playbackActive, playbackGroupIds, selected, surface.index],
  );
  return (
    <MusicXmlPageSurface
      page={surface}
      highlighted={highlighted}
      highlightKind={playbackActive ? "playback" : "selected"}
    />
  );
});

/**
 * While `open`, a press anywhere outside `area`, the popover with the button that opens
 * it, calls `close`. A field in it being typed in loses focus first, so what it holds is
 * taken before the popover goes.
 */
function useCloseOnPressOutside(open: boolean, area: RefObject<HTMLElement | null>, close: () => void) {
  const latestClose = useRef(close);
  latestClose.current = close;
  useEffect(() => {
    if (!open) return;
    function closeOnPressOutside(event: PointerEvent) {
      const element = area.current;
      if (!element || (event.target instanceof Node && element.contains(event.target))) return;
      const focused = window.document.activeElement;
      if (focused instanceof HTMLElement && element.contains(focused)) focused.blur();
      latestClose.current();
    }
    window.addEventListener("pointerdown", closeOnPressOutside, true);
    return () => window.removeEventListener("pointerdown", closeOnPressOutside, true);
  }, [open, area]);
}

export function DocumentViewer({
  documentKey,
  pages: documentPages,
  noteGeometry,
  selectedGroup,
  highlightAllNotes,
  showOriginalNoteheadContours,
  showDetectedNoteheadContours,
  showRefinedNoteheadContours,
  showRawStemContours,
  showDiagnosticVisualGroups = false,
  showUnsupportedRests = false,
  showValueMismatches = false,
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
  practiceHand = "both",
  practicedHandSoundEnabled = true,
  otherHandSoundEnabled = false,
  noteHighwayEnabled = false,
  noteHighwayVisible = false,
  listenFeedback,
  loopMode = false,
  loop = null,
  loopPass = 1,
  loopPlaying = false,
  loopDimOutside = true,
  onLoopToggle,
  onLoopChange,
  onLoopDragChange,
  initialViewportTransform,
  onViewportTransformChange,
  onPlaybackCommand,
  onPlaybackModeChange,
  onTempoMultiplierChange,
  onNoteHighwayToggle,
  onPracticeHandChange,
  onPracticedHandSoundChange,
  onOtherHandSoundChange,
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
  const [handSoundMenuOpen, setHandSoundMenuOpen] = useState(false);
  const tempoControlRef = useRef<HTMLDivElement | null>(null);
  const handSoundControlRef = useRef<HTMLDivElement | null>(null);
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
  const geometryByPage = useMemo(() => noteGeometryByPage(noteGeometry), [noteGeometry]);
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
    const inputLabel = lifecycle.inputSource === "midi" ? "MIDI input" : "Microphone";
    if (lifecycle.state === "error") return `Listen error: ${lifecycle.error ?? "Unknown error"}`;
    if (lifecycle.state === "initializing") {
      const input = lifecycle.input === "ready"
        ? `${inputLabel} ready`
        : `Starting ${inputLabel.toLowerCase()}`;
      const analysis = lifecycle.analysis === "ready"
        ? "Recognition ready"
        : "Starting recognition";
      return `${input} · ${analysis}`;
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
      `${inputLabel} ready · Target ${target}`,
      heard ? `Heard ${heard}` : "Waiting for a fresh onset",
      extras ? `Extra ${extras}` : "",
      targetSignals ? `Signal ${targetSignals}` : "",
    ].filter(Boolean).join(" · ") + processing;
  }, [listenFeedback]);
  const scoreSystems = useMemo(() => loopSystems(noteGeometry), [noteGeometry]);
  const scoreMeasureCount = loopMeasureCount(scoreSystems);
  const [loopDrag, setLoopDrag] = useState<{
    handle: LoopHandle;
    pointerId: number;
    region: LoopRegion;
  } | null>(null);
  const [loopHover, setLoopHover] = useState<LoopHandle | null>(null);
  const shownLoop = loop ? loopDrag?.region ?? loop : null;
  const loopView = useMemo(() => {
    if (!shownLoop) return null;
    const segments = loopSegments(scoreSystems, shownLoop);
    // The label goes on the widest part of a loop that spans several systems.
    const labelSegment = segments.reduce<(typeof segments)[number] | null>(
      (widest, segment) =>
        !widest || segment.right - segment.left > widest.right - widest.left ? segment : widest,
      null,
    );
    return { region: shownLoop, segments, labelSegment };
  }, [scoreSystems, shownLoop?.startMeasure, shownLoop?.endMeasure]);
  const loopLatest = useRef({
    loop,
    loopDrag,
    onLoopChange,
    scoreSystems,
    scoreMeasureCount,
    displayPages,
    scheduleTransform,
    scoreViewBottom,
  });
  loopLatest.current = {
    loop,
    loopDrag,
    onLoopChange,
    scoreSystems,
    scoreMeasureCount,
    displayPages,
    scheduleTransform,
    scoreViewBottom,
  };
  // Where a dragged handle's pointer is, and the frame that scrolls the view under it.
  const loopPointer = useRef<{ x: number; y: number } | null>(null);
  // Which way the pointer is heading along each axis.
  const loopHeading = useRef<{ x: LoopHeading; y: LoopHeading }>({
    x: { heading: 0, turn: 0 },
    y: { heading: 0, turn: 0 },
  });
  const loopScrollFrame = useRef<number | null>(null);
  const followLoopPointer = useRef(() => undefined as void);
  // Detaches the listeners of the drag under way; ends that drag.
  const endLoopDrag = useRef(() => undefined as void);
  const finishLoopDrag = useRef((_commit: boolean) => undefined as void);
  const revealLoopBoundary = useRef((_region: LoopRegion, _handle: LoopHandle) => undefined as void);
  const shownLoopBefore = useRef<LoopRegion | null>(null);
  // When a loop end last moved, so realtime following leaves the view on it a while.
  const loopEditedAt = useRef(Number.NEGATIVE_INFINITY);
  // When a handle was last dropped: the highway coming back must not pull the view away.
  const loopDroppedAt = useRef(Number.NEGATIVE_INFINITY);
  const loopDragging = loopDrag !== null;
  const loopDraggingBefore = useRef(false);
  useEffect(() => {
    if (loopDragging === loopDraggingBefore.current) return;
    loopDraggingBefore.current = loopDragging;
    if (!loopDragging) loopDroppedAt.current = performance.now();
    onLoopDragChange?.(loopDragging);
  }, [loopDragging]);
  useEffect(() => () => onLoopDragChange?.(false), []);
  useEffect(() => {
    if (!loop) {
      finishLoopDrag.current(false);
      setLoopHover(null);
    }
  }, [loop]);
  useEffect(() => () => finishLoopDrag.current(false), []);
  // The view moved under a held handle, by edge scrolling or the wheel: the handle
  // follows the pointer to the barline now beneath it.
  useEffect(() => {
    if (loopLatest.current.loopDrag) followLoopPointer.current();
  }, [transform]);
  // A loop end moved from the keyboard, a shortcut or a dropped handle comes into view,
  // so a loop can be stretched past what the view shows.
  useEffect(() => {
    const before = shownLoopBefore.current;
    shownLoopBefore.current = loop ?? null;
    if (!loop || !before || loopLatest.current.loopDrag) return;
    if (loop.endMeasure !== before.endMeasure || loop.startMeasure !== before.startMeasure) {
      loopEditedAt.current = performance.now();
    }
    if (loop.endMeasure !== before.endMeasure) revealLoopBoundary.current(loop, "end");
    else if (loop.startMeasure !== before.startMeasure) revealLoopBoundary.current(loop, "start");
  }, [loop?.startMeasure, loop?.endMeasure]);
  // Stable, so the page layers re-render only when what they draw changes.
  const loopHandleEvents = useMemo<LoopHandleEvents>(() => {
    const screenSystems = (): ScreenLoopSystem[] => {
      const { scoreSystems: systems, displayPages: shown } = loopLatest.current;
      return systems.flatMap((system) => {
        const rect = pageRefs.current.get(system.pageIndex)?.getBoundingClientRect();
        const page = shown.find((candidate) => candidate.page.index === system.pageIndex);
        if (!rect || !page || page.width <= 0) return [];
        const pixels = rect.width / page.width;
        return [{
          top: rect.top + system.top * pixels,
          bottom: rect.top + system.bottom * pixels,
          firstMeasure: system.firstMeasure,
          barlines: system.barlines.map((x) => rect.left + x * pixels),
        }];
      });
    };
    const followPointer = () => {
      const { loopDrag: drag, scoreMeasureCount: count } = loopLatest.current;
      const pointer = loopPointer.current;
      if (!drag || !pointer) return;
      const region = draggedLoopRegion(
        drag.region,
        drag.handle,
        screenSystems(),
        pointer.x,
        pointer.y,
        count,
        LOOP_HANDLE_REACH,
      );
      if (region !== drag.region) {
        const next = { ...drag, region };
        loopLatest.current.loopDrag = next;
        setLoopDrag(next);
      }
    };
    followLoopPointer.current = followPointer;
    const stopScrolling = () => {
      if (loopScrollFrame.current !== null) cancelAnimationFrame(loopScrollFrame.current);
      loopScrollFrame.current = null;
    };
    // The whole of a handle on `boundary`, grip tab and all, with some room around it,
    // from the stage's corner, and the system it is drawn on.
    const handleOnScreen = (boundary: number, handle: LoopHandle, stage: DOMRect) => {
      const { scoreSystems: systems, displayPages: shown } = loopLatest.current;
      const placement = loopBoundaryPlacement(systems, boundary, handle);
      const rect = placement ? pageRefs.current.get(placement.system.pageIndex)?.getBoundingClientRect() : null;
      const page = placement ? shown.find((candidate) => candidate.page.index === placement.system.pageIndex) : null;
      if (!placement || !rect || !page || page.width <= 0) return null;
      const pixels = rect.width / page.width;
      const x = rect.left - stage.left + placement.x * pixels;
      return {
        system: placement.system,
        left: x - LOOP_SCROLL_PADDING,
        right: x + LOOP_SCROLL_PADDING,
        top: rect.top - stage.top + placement.system.top * pixels - LOOP_HANDLE_REACH.above - LOOP_SCROLL_PADDING / 2,
        bottom: rect.top - stage.top + placement.system.bottom * pixels + LOOP_HANDLE_REACH.below + LOOP_SCROLL_PADDING / 2,
      };
    };
    // While the pointer holds a handle near an edge of the view, the score scrolls on
    // under it, and the handle follows to the barlines that come into view.
    const scrollFrame = () => {
      loopScrollFrame.current = null;
      const { loopDrag: drag, scheduleTransform: schedule, scoreViewBottom: viewBottom } = loopLatest.current;
      const pointer = loopPointer.current;
      const stage = stageRef.current?.getBoundingClientRect();
      if (!drag || !pointer || !stage) return;
      const current = transformRef.current;
      const { width, height } = layoutRef.current;
      let dx = loopEdgeScrollStep(
        pointer.x - stage.left,
        0,
        stage.width,
        current.x - LOOP_SCROLL_PADDING,
        current.x + width * current.scale + LOOP_SCROLL_PADDING,
        loopHeading.current.x.heading,
      );
      let dy = loopEdgeScrollStep(
        pointer.y - stage.top,
        0,
        viewBottom(),
        current.y - LOOP_SCROLL_PADDING,
        current.y + height * current.scale + LOOP_SCROLL_PADDING,
        loopHeading.current.y.heading,
      );
      // Past the barline a measure from the other handle there is nothing to drag to.
      const { region, handle } = drag;
      const limit = handle === "start" ? region.endMeasure - 1 : region.startMeasure + 1;
      const reach = handleOnScreen(limit, handle, stage);
      if (reach) {
        dy = loopScrollStepWithinReach(dy, handle, reach.top, reach.bottom, 0, viewBottom());
        // Across, only while the handle is on that barline's system: on another, all of
        // its own system's width is still within reach.
        const held = handleOnScreen(handle === "start" ? region.startMeasure : region.endMeasure, handle, stage);
        if (held?.system === reach.system) {
          dx = loopScrollStepWithinReach(dx, handle, reach.left, reach.right, 0, stage.width);
        }
      }
      if (dx === 0 && dy === 0) return;
      schedule((latest) => ({ ...latest, x: latest.x + dx, y: latest.y + dy }));
      followPointer();
      loopScrollFrame.current = requestAnimationFrame(scrollFrame);
    };
    // Moves the document so a boundary the keyboard moved, and its system, are in view.
    const revealBoundary = (region: LoopRegion, handle: LoopHandle) => {
      const { scheduleTransform: schedule, scoreViewBottom: viewBottom } = loopLatest.current;
      const stage = stageRef.current?.getBoundingClientRect();
      const boundary = handle === "start" ? region.startMeasure : region.endMeasure;
      const shown = stage ? handleOnScreen(boundary, handle, stage) : null;
      if (!stage || !shown) return;
      const dx = revealOffset(shown.left, shown.right, 0, stage.width);
      const dy = revealOffset(shown.top, shown.bottom, 0, viewBottom());
      if (dx !== 0 || dy !== 0) schedule((latest) => ({ ...latest, x: latest.x + dx, y: latest.y + dy }));
    };
    revealLoopBoundary.current = revealBoundary;
    /** Ends the drag, keeping the dragged region when `commit` is set. */
    const finish = (commit: boolean) => {
      const { loop: current, loopDrag: drag, onLoopChange: change } = loopLatest.current;
      stopScrolling();
      loopPointer.current = null;
      endLoopDrag.current();
      if (!drag) return;
      const stage = stageRef.current;
      if (stage?.hasPointerCapture(drag.pointerId)) stage.releasePointerCapture(drag.pointerId);
      loopLatest.current.loopDrag = null;
      setLoopDrag(null);
      if (
        commit && current &&
        (drag.region.startMeasure !== current.startMeasure || drag.region.endMeasure !== current.endMeasure)
      ) {
        change?.(drag.region);
      }
    };
    finishLoopDrag.current = finish;
    return {
      onPointerDown(handle: LoopHandle, event: ReactPointerEvent<SVGElement>) {
        const { loop: current } = loopLatest.current;
        const stage = stageRef.current;
        if (!current || !stage || event.button !== 0) return;
        // The handle takes the pointer; the score must not pan or select under it.
        event.stopPropagation();
        event.preventDefault();
        finish(false);
        // The handle is redrawn on whichever page its barline lies, which can unmount the
        // element pressed, so the stage holds the pointer and the window follows it.
        const pointerId = event.pointerId;
        stage.setPointerCapture(pointerId);
        const drag = { handle, pointerId, region: current };
        loopLatest.current.loopDrag = drag;
        loopPointer.current = { x: event.clientX, y: event.clientY };
        loopHeading.current = {
          x: { heading: 0, turn: event.clientX },
          y: { heading: 0, turn: event.clientY },
        };
        setLoopDrag(drag);
        const move = (moved: PointerEvent) => {
          if (moved.pointerId !== pointerId) return;
          // A release the window never saw: the button is already up.
          if (moved.pointerType === "mouse" && (moved.buttons & 1) === 0) {
            finish(true);
            return;
          }
          const heading = loopHeading.current;
          loopHeading.current = {
            x: nextLoopHeading(heading.x, moved.clientX),
            y: nextLoopHeading(heading.y, moved.clientY),
          };
          loopPointer.current = { x: moved.clientX, y: moved.clientY };
          followPointer();
          if (loopScrollFrame.current === null) scrollFrame();
        };
        const up = (released: PointerEvent) => {
          if (released.pointerId === pointerId) finish(true);
        };
        const cancel = (cancelled: PointerEvent) => {
          if (cancelled.pointerId === pointerId) finish(false);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        stage.addEventListener("lostpointercapture", up);
        endLoopDrag.current = () => {
          endLoopDrag.current = () => undefined;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          stage.removeEventListener("lostpointercapture", up);
        };
      },
      onKeyDown(handle: LoopHandle, event: ReactKeyboardEvent<SVGElement>) {
        const { loop: current, onLoopChange: change, scoreMeasureCount: count } = loopLatest.current;
        if (!current || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        // Arrow keys move the focused handle, not the playhead.
        event.preventDefault();
        event.stopPropagation();
        const boundary = (handle === "start" ? current.startMeasure : current.endMeasure) +
          (event.key === "ArrowLeft" ? -1 : 1);
        const region = moveLoopHandleTo(current, handle, boundary, count);
        if (region !== current) change?.(region);
      },
      onHover(handle: LoopHandle | null) {
        setLoopHover(handle);
      },
    };
  }, []);
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

  useCloseOnPressOutside(tempoPopoverOpen, tempoControlRef, () => setTempoPopoverOpen(false));
  useCloseOnPressOutside(handSoundMenuOpen, handSoundControlRef, () => setHandSoundMenuOpen(false));

  useEffect(() => {
    if (playbackMode !== "realtime") setTempoPopoverOpen(false);
  }, [playbackMode]);

  useEffect(() => {
    if (practiceHand === "both") setHandSoundMenuOpen(false);
  }, [practiceHand]);

  useEffect(() => {
    if (!handSoundMenuOpen) return;
    function closeHandSoundMenu(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setHandSoundMenuOpen(false);
    }
    window.addEventListener("keydown", closeHandSoundMenu, true);
    return () => window.removeEventListener("keydown", closeHandSoundMenu, true);
  }, [handSoundMenuOpen]);

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

  /**
   * Where, from the top of the view, the score stops being visible during playback: the
   * note highway or the keyboard covers what lies below.
   */
  function scoreViewBottom(): number {
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    if (!stage || !rect) return 0;
    const keyboardHeight = Math.min(210, Math.max(150, window.innerHeight * 0.24));
    // The highway is positioned against the workspace, which this viewer fills.
    const viewerRect = stage.parentElement?.getBoundingClientRect() ?? rect;
    const obscuredFrom = noteHighwayVisible
      ? viewerRect.top + viewerRect.height * NOTE_HIGHWAY_TOP_FRACTION - rect.top
      : rect.height - keyboardHeight - 20;
    return Math.max(rect.height * 0.12 + 80, obscuredFrom);
  }

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
      const geometry = geometryByPage.get(page.index);
      if (!geometry) continue;
      const element = pageRefs.current.get(page.index);
      const rect = element?.getBoundingClientRect();
      if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }
      const point: VisualPoint = [
        ((clientX - rect.left) / rect.width) * page.width,
        ((clientY - rect.top) / rect.height) * page.height,
      ];
      const notehead = noteheadAt(
        geometry,
        pageDiagnosticNoteheads(page, showDiagnosticVisualGroups),
        point,
      );
      onSelectGroup(
        notehead ? { pageIndex: page.index, visualGroupId: notehead.id } : null,
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
    // The view is the loop handle's while one is dragged, and in realtime, where the
    // playhead moves on regardless, for a moment after a loop end moved.
    if (loopLatest.current.loopDrag) return;
    if (performance.now() - loopDroppedAt.current < LOOP_EDIT_FOLLOW_HOLD_MS) return;
    if (
      (effectiveStatus === "playing" || effectiveStatus === "paused") &&
      performance.now() - loopEditedAt.current < LOOP_EDIT_FOLLOW_HOLD_MS
    ) return;
    const stage = stageRef.current;
    const page = pages.find((candidate) => candidate.index === playbackMoment.pageIndex);
    const rect = stage?.getBoundingClientRect();
    if (!stage || !page || !rect) return;
    const extents = playbackMomentExtents(geometryByPage.get(page.index), page, playbackMoment);
    if (!extents) return;

    const pageTop = pages
      .filter((candidate) => candidate.index < page.index)
      .reduce((total, candidate) => total + candidate.height + PAGE_GAP, 0);
    const pageLeft = (layout.width - page.width) / 2;
    const verticalPadding = Math.max(18, page.height * 0.018);
    const horizontalPadding = Math.max(18, page.width * 0.02);
    const staffTop = pageTop + extents.system[1] - verticalPadding;
    const staffBottom = pageTop + extents.system[3] + verticalPadding;
    const staffLeft = pageLeft + extents.system[0] - horizontalPadding;
    const staffRight = pageLeft + extents.system[2] + horizontalPadding;
    const momentLeft = pageLeft + extents.momentLeft;
    const momentRight = pageLeft + extents.momentRight;
    const momentContentLeft = pageLeft + extents.contentLeft;
    const momentContentRight = pageLeft + extents.contentRight;
    const current = transformRef.current;
    const safeTop = rect.height * 0.12;
    const safeBottom = scoreViewBottom();
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
  }, [geometryByPage, layout.width, noteHighwayVisible, pages, playbackActive, playbackMoment]);

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
              title="Step through the notes yourself (N)"
              onClick={() => onPlaybackModeChange?.("note-by-note")}
            >Note-by-note</button>
            <div className={`realtime-mode-control${realtimeAvailable ? "" : " unavailable"}`}>
              <button
                type="button"
                className={playbackMode === "realtime" ? "selected" : ""}
                aria-pressed={playbackMode === "realtime"}
                aria-describedby={!realtimeAvailable ? realtimeUnavailableTooltipId : undefined}
                title={realtimeAvailable ? "Use audio-clock playback (N)" : undefined}
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
          {onPracticeHandChange ? (
            <div
              className="playback-mode-selector practice-hand-selector"
              role="group"
              aria-label="Practice hand"
            >
              {PRACTICE_HAND_OPTIONS.map(({ hand, label, description, shortcut }) => (
                <button
                  key={hand}
                  type="button"
                  className={practiceHand === hand ? "selected" : ""}
                  aria-label={description}
                  aria-pressed={practiceHand === hand}
                  title={shortcut ? `${description} (${shortcut})` : description}
                  onClick={() => onPracticeHandChange(hand)}
                >{label}</button>
              ))}
            </div>
          ) : null}
          {onNoteHighwayToggle ? (
            <button
              type="button"
              className={`note-highway-toggle${noteHighwayEnabled ? " active" : ""}`}
              aria-label={noteHighwayEnabled ? "Hide 3D note highway" : "Show 3D note highway"}
              aria-pressed={noteHighwayEnabled}
              title={noteHighwayEnabled ? "Hide the 3D note highway" : "Show notes approaching the keyboard in 3D"}
              onClick={onNoteHighwayToggle}
            >3D</button>
          ) : null}
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
          {onLoopToggle ? (
            <button
              type="button"
              className={`loop-toggle${loopMode ? " active" : ""}${loopMode && loopPlaying ? " looping" : ""}`}
              aria-label={loopMode ? "Turn loop mode off" : "Turn loop mode on"}
              aria-pressed={loopMode}
              title={loopMode
                ? "Stop looping (L)"
                : "Loop the bar being played; drag the handles to loop more (L)"}
              disabled={!effectivelyActive && !loopMode}
              onClick={onLoopToggle}
            >
              <LoopIcon />
              <span className="loop-toggle-label">
                {loopMode && loopPlaying ? `Pass ${loopPass}` : "Loop"}
              </span>
            </button>
          ) : null}
          <div ref={handSoundControlRef} className="hand-sound-control">
            <button
              type="button"
              className={`sound-toggle${playbackNoteSoundsEnabled ? " active" : ""}`}
              aria-label={playbackNoteSoundsEnabled ? "Mute note sounds" : "Play note sounds"}
              aria-pressed={playbackNoteSoundsEnabled}
              title={playbackNoteSoundsEnabled ? "Mute note sounds (M)" : "Play note sounds (M)"}
              disabled={!effectivelyActive}
              onClick={() => onPlaybackCommand("toggleNoteSounds")}
            >{playbackNoteSoundsEnabled ? "🔊" : "🔇"}</button>
            {onPracticeHandChange ? (
              <button
                type="button"
                className="hand-sound-menu-button"
                aria-label="Hand sound options"
                aria-expanded={handSoundMenuOpen}
                aria-haspopup="dialog"
                title={practiceHand === "both"
                  ? "Choose LH or RH to set each hand's sound"
                  : "Choose which hands sound"}
                disabled={practiceHand === "both"}
                onClick={() => setHandSoundMenuOpen((open) => !open)}
              >▾</button>
            ) : null}
            {handSoundMenuOpen && practiceHand !== "both" ? (
              <div className="hand-sound-popover" role="dialog" aria-label="Hand sound">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={practicedHandSoundEnabled}
                    onChange={(event) => onPracticedHandSoundChange?.(event.target.checked)}
                  />
                  Practiced hand ({practiceHand === "left" ? "LH" : "RH"})
                </label>
                <label
                  className={`checkbox-row${playbackMode === "realtime" ? "" : " disabled"}`}
                  title={playbackMode === "realtime"
                    ? undefined
                    : "Accompaniment is available in Realtime"}
                >
                  <input
                    type="checkbox"
                    checked={otherHandSoundEnabled}
                    disabled={playbackMode !== "realtime"}
                    onChange={(event) => onOtherHandSoundChange?.(event.target.checked)}
                  />
                  Other hand ({practiceHand === "left" ? "RH" : "LH"})
                </label>
                {playbackMode === "realtime" ? null : (
                  <p className="hand-sound-note">Accompaniment is available in Realtime.</p>
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`listen-toggle${listenActive ? " active" : ""}`}
            aria-label={listenActive ? "Disable listen mode" : "Enable listen mode"}
            aria-pressed={listenActive}
            title={listenActive ? "Disable listen mode (I)" : "Listen and advance when the chord is played (I)"}
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
            <div ref={tempoControlRef} className="tempo-control">
              <button
                type="button"
                className="tempo-button"
                aria-label={`Tempo ${Math.round(tempoBpm)} BPM`}
                title="Tempo; Shift+Up and Shift+Down change it by 1%"
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
        className={`viewer-stage${isPointerPanning ? " is-pointer-panning" : ""}${loopDragging ? " is-loop-dragging" : ""}`}
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
              {page.surface ? (
                <EngravedPage
                  surface={page.surface}
                  geometry={geometryByPage.get(page.index)}
                  selected={selectedGroup}
                  highlightAll={highlightAllNotes}
                  playbackActive={playbackActive}
                  playbackGroupIds={
                    realtimeGroupIdsByPage
                      ? realtimeGroupIdsByPage[page.index] ?? NO_REALTIME_GROUPS
                      : playbackGroupIdsForPage(playbackMoment, page.index)
                  }
                />
              ) : page.imageUrl ? (
                <img src={page.imageUrl} alt={`Sheet music page ${page.index + 1}`} draggable={false} />
              ) : null}
              {loopView && scoreSystems.some((system) => system.pageIndex === page.index) ? (
                <>
                  <LoopPageTint
                    width={page.width}
                    height={page.height}
                    segments={loopView.segments.filter((segment) => segment.system.pageIndex === page.index)}
                    scale={transform.scale}
                    active={loopHover !== null || loopDrag !== null}
                  />
                  <LoopPageLayer
                    pageIndex={page.index}
                    width={page.width}
                    height={page.height}
                    systems={scoreSystems}
                    region={loopView.region}
                    segments={loopView.segments}
                    labelSegment={loopView.labelSegment}
                    scale={transform.scale}
                    measureCount={scoreMeasureCount}
                    dimOutside={loopDimOutside}
                    dragging={loopDrag?.handle ?? null}
                    hover={loopHover}
                    events={loopHandleEvents}
                  />
                </>
              ) : null}
              <PageOverlay
                page={page}
                geometry={geometryByPage.get(page.index)}
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
                showUnsupportedRests={showUnsupportedRests}
                showValueMismatches={showValueMismatches}
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
