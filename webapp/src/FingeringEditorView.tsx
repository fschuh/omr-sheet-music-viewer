// The fingering editor's views: its toolbar controls, the labels it draws over an engraved
// page with the finger picker, and the strip describing the ringed note. Shape tells the
// layers apart rather than hue, so it survives custom hand colours and colour blindness:
// a predicted finger is an outline in its hand's colour, the player's own is filled, and a
// printed one stays the score's own digit.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { editorLabels, printedFingerReplaced, type EditorLabel, type FingeringEditor } from "./fingeringEditor";
import { fingeringLabelLayout, labelColumn, type EffectiveFingering, type MusicXmlPage } from "./musicxml";
import { formatKeyboardShortcut, type PlaybackShortcuts } from "./shortcuts";
import { createPortal } from "react-dom";
import type { RevealElement } from "./DocumentViewer";
import type { PlaybackCommand } from "./playback";

const FINGER_NAMES = ["thumb", "index finger", "middle finger", "ring finger", "little finger"];

function keyName(shortcuts: PlaybackShortcuts, command: PlaybackCommand): string {
  return formatKeyboardShortcut(shortcuts[command].keyboard);
}

/** Labels, picker and toolbar take presses before the score can pan or select. */
function stop(event: ReactPointerEvent) {
  event.stopPropagation();
}

function PencilIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M3 15l1-4 8-8 3 3-8 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10.5 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function FingeringToolbar({
  editor,
  shortcuts,
}: {
  editor: FingeringEditor;
  shortcuts: PlaybackShortcuts;
}) {
  if (!editor.available) return null;
  const toggleKey = keyName(shortcuts, "toggleFingerEditing");
  return (
    <div className="fingering-toolbar" role="group" aria-label="Fingering editor">
      <button
        type="button"
        className={`fingering-edit-toggle${editor.editing ? " active" : ""}`}
        aria-pressed={editor.editing}
        title={editor.editing
          ? `Back to playback at the selected note (${toggleKey} or Esc)`
          : `Edit the fingers of the notes; playback stops while you do (${toggleKey})`}
        onClick={editor.toggle}
      >
        <PencilIcon />
        Edit fingers
        <kbd>{toggleKey}</kbd>
      </button>
      {editor.editing ? (
        <>
          <button
            type="button"
            disabled={!editor.canUndo}
            title={`Undo the last finger edit (${keyName(shortcuts, "undoFingerEdit")})`}
            onClick={editor.undo}
          >Undo</button>
          <button
            type="button"
            disabled={!editor.refitNeeded || editor.refitting}
            title={editor.refitNeeded
              ? "Predict the other notes again around your fingers and hand changes. Your own fingers are kept."
              : "The predictions already take your fingers into account"}
            onClick={editor.refit}
          >{editor.refitting ? "Re-fitting…" : "Re-fit fingerings"}</button>
        </>
      ) : null}
    </div>
  );
}

function handClass(left: boolean): string {
  return left ? "left-hand" : "right-hand";
}

function labelText(id: string, fingering: EffectiveFingering, pitch: string | null): string {
  const hand = fingering.left ? "left" : "right";
  const who = fingering.source === "yours" ? "yours" : fingering.source === "printed" ? "printed in the score" : "predicted";
  return `${pitch ?? id}, ${hand} hand finger ${fingering.finger}, ${who}`;
}

/** Where a page stands in the layer that holds the pages, in that layer's own pixels. */
interface PageFrame {
  host: HTMLElement;
  page: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The finger picker, standing just outside the ringed note's label. */
function FingerPicker({
  editor,
  fingering,
  anchor,
  above,
  scale,
  pageWidth,
  pageHeight,
  frame,
  reveal,
}: {
  editor: FingeringEditor;
  fingering: EffectiveFingering;
  anchor: { x: number; y: number };
  above: boolean;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  /** Where its page stands in the layer that holds the pages, which the picker is drawn in. */
  frame: PageFrame;
  /** Scrolls the picker into view. */
  reveal?: RevealElement;
}) {
  const cursor = editor.cursor!;
  // Shown for a note, or moved to another, the picker is brought wholly into view: the score
  // scrolls up or down for it, and at a side of the view, or of the page, which clips what
  // stands past it, the picker slides along that edge, in screen pixels, with its caret still
  // on the note.
  const pickerRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    const stage = picker?.closest(".viewer-stage")?.getBoundingClientRect();
    const page = frame.page.getBoundingClientRect();
    if (!picker || !stage) return;
    const view = { left: Math.max(stage.left, page.left), right: Math.min(stage.right, page.right) };
    const box = picker.getBoundingClientRect();
    // Where it would stand centred on the note.
    const left = box.left - slide;
    const right = box.right - slide;
    const margin = 8;
    let next = 0;
    if (right > view.right - margin) next = view.right - margin - right;
    if (left + next < view.left + margin) next = view.left + margin - left;
    // The caret stays clear of the picker's rounded corners.
    const most = Math.max(0, box.width / 2 - 18);
    next = Math.max(-most, Math.min(most, next));
    if (Math.abs(next - slide) > 0.5) setSlide(next);
  });
  useLayoutEffect(() => {
    if (pickerRef.current) reveal?.(pickerRef.current);
  }, [anchor.x, anchor.y, above, cursor.id, reveal]);
  const chord = editor.momentNotes.filter((target) => editor.fingerings?.[target.id]?.left === fingering.left);
  const place = chord.findIndex((target) => target.id === cursor.id);
  const other = fingering.left ? "right" : "left";
  const resetLabel = fingering.basePrinted ? "Use the printed finger" : "Use the predicted finger";
  const hasOverride = fingering.source === "yours" || fingering.handMoved;
  // Over its page but outside it: a page clips what stands past its edges, and the picker of
  // a note near the page's top or bottom stands past them.
  return createPortal(
    <div
      ref={pickerRef}
      className={`finger-picker ${handClass(fingering.left)}${above ? " above" : " below"}`}
      role="group"
      aria-label={`Finger for ${cursor.pitch}`}
      style={{
        left: frame.left + (anchor.x / pageWidth) * frame.width,
        top: frame.top + (anchor.y / pageHeight) * frame.height,
        transform: `translate(calc(-50% + ${slide / scale}px), ${above ? "-100%" : "0"}) scale(${1 / scale})`,
        transformOrigin: above ? "50% 100%" : "50% 0",
        ["--caret-slide" as string]: `${-slide}px`,
      }}
      onPointerDown={stop}
      onPointerMove={stop}
    >
      {chord.length > 1 ? (
        <div className="finger-picker-chord" role="group" aria-label="Move among the notes at this moment">
          <button
            type="button"
            aria-label="Higher note"
            disabled={place <= 0}
            onClick={() => editor.moveInMoment(-1)}
          >▲</button>
          <button
            type="button"
            aria-label="Lower note"
            disabled={place >= chord.length - 1}
            onClick={() => editor.moveInMoment(1)}
          >▼</button>
        </div>
      ) : null}
      <div className="finger-picker-note">
        <strong>{cursor.pitch.replace("#", "♯")}</strong>
        {chord.length > 1 ? <span>{place + 1}/{chord.length}</span> : null}
      </div>
      {[1, 2, 3, 4, 5].map((finger) => {
        const base = finger === fingering.baseFinger;
        // New buttons for each note: moved to another, the picker shows that note's finger at
        // once, where the same buttons would fade from the last note's. A finger picked for
        // the note still fades in.
        return (
          <button
            key={`${cursor.id}|${finger}`}
            type="button"
            className={`finger-picker-digit${finger === fingering.finger ? " selected" : ""}`}
            aria-pressed={finger === fingering.finger}
            aria-label={`${finger}, ${FINGER_NAMES[finger - 1]}${base ? (fingering.basePrinted ? ", printed" : ", predicted") : ""}`}
            onClick={() => editor.pickFinger(finger)}
          >
            {finger}
            {base ? <span className="finger-picker-base" aria-hidden="true" /> : null}
          </button>
        );
      })}
      <span className="finger-picker-divider" aria-hidden="true" />
      <button
        type="button"
        className={`finger-picker-hand ${handClass(!fingering.left)}`}
        aria-label={`Play ${cursor.pitch} with the ${other} hand`}
        title={`Play with the ${other} hand`}
        onClick={editor.swapHand}
      >⇄ {fingering.left ? "RH" : "LH"}</button>
      <button
        type="button"
        className="finger-picker-reset"
        aria-label={resetLabel}
        title={resetLabel}
        disabled={!hasOverride}
        onClick={editor.resetHere}
      >↺</button>
    </div>,
    frame.host,
  );
}

/** How far a moved note's dashed ring stands off its head, in staff spaces: close, to keep clear of its dots and accidentals. */
const MOVED_RING_GAP = 0.22;

/**
 * How a label looks: filled when the player changed its note, its finger or its hand; as
 * print, a digit without a circle, for a printed finger kept, labelled for its chord's sake;
 * otherwise outlined, as predicted.
 */
type LabelLook = "yours" | "printed" | "predicted";

function labelLook(fingering: EffectiveFingering, label: EditorLabel | undefined): LabelLook {
  if (fingering.source === "yours" || fingering.handMoved) return "yours";
  return label?.printed ? "printed" : "predicted";
}

/**
 * A label's circle and digit, centred on the origin. A printed finger's serif digit sits a
 * little higher than the others' sans: each font's digits are lowered by what centres them.
 */
function LabelFace({ size, finger, look }: { size: number; finger: number; look: LabelLook }) {
  return (
    <g className="fingering-label-body">
      <circle className="fingering-face" r={size / 2 - size * 0.04} strokeWidth={size * 0.08} />
      <text dy={look === "printed" ? "0.33em" : "0.36em"} fontSize={size * 0.62}>{finger}</text>
    </g>
  );
}

/** One finger label. Its props are plain values, so an edit redraws only the labels it changes. */
const FingeringLabel = memo(function FingeringLabel({
  id, x, y, size, left, finger, look, text, onPick, onHover,
}: {
  id: string;
  x: number;
  y: number;
  size: number;
  left: boolean;
  finger: number;
  look: LabelLook;
  text: string;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <g
      className={`fingering-label ${handClass(left)} ${look}`}
      transform={`translate(${x} ${y})`}
      role="button"
      aria-label={text}
      onPointerDown={stop}
      // The page looks for a notehead under the pointer; over a label there is none to find.
      onPointerMove={stop}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => onPick(id)}
    >
      <LabelFace size={size} finger={finger} look={look} />
    </g>
  );
});

/**
 * The fingering labels of one engraved page while editing, with the finger picker of the
 * ringed note when it is on this page.
 */
export const FingeringPageLayer = memo(function FingeringPageLayer({
  page,
  editor,
  scale,
  displayWidth,
  reveal,
}: {
  page: MusicXmlPage;
  editor: FingeringEditor;
  scale: number;
  /** The page's width on screen before zooming, which the moving marks are placed in. */
  displayWidth: number;
  /** Scrolls an element of the layer, the finger picker, into view. */
  reveal?: RevealElement;
}) {
  const fingerings = editor.fingerings;
  const prefix = `page-${page.index + 1}-`;
  const notes = useMemo(
    () => new Map(page.chords.flatMap((chord) => chord.notes.map((note) => [note.key, note] as const))),
    [page],
  );
  const chordOf = useMemo(
    () => new Map(page.chords.flatMap((chord) => chord.notes.map((note) => [note.key, chord] as const))),
    [page],
  );
  // Where labels go depends only on which notes have one and on which hand, so a new finger
  // does not place the page's labels again.
  const hands = useMemo(
    () => editorLabels(page, (key) => fingerings?.[prefix + key]),
    [fingerings, page, prefix],
  );
  const handsSignature = useMemo(
    () => [...hands].map(([key, { left, moved, printed }]) => `${key}:${left ? "L" : "R"}${moved ? "m" : ""}${printed ? "p" : ""}`).join("|"),
    [hands],
  );
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const layout = useMemo(
    () => fingeringLabelLayout(page, (key) => handsRef.current.get(key)?.left, (key) => handsRef.current.get(key)?.moved ?? false),
    // The signature stands for the hands.
    [page, handsSignature],
  );
  // The band over the cursor's moment keeps one size within a system: as wide as a label
  // with a margin, and as tall as the system's highest label to its lowest, so only its
  // place changes from note to note.
  const systemReach = useMemo(() => {
    const result = new Map<number, { top: number; bottom: number }>();
    page.systems.forEach((system, index) => result.set(index, { top: system.top, bottom: system.bottom }));
    for (const label of layout.labels) {
      const index = Number(label.stackId.slice(0, label.stackId.indexOf("|")));
      const reach = result.get(index);
      if (!reach) continue;
      reach.top = Math.min(reach.top, label.y - layout.size / 2);
      reach.bottom = Math.max(reach.bottom, label.y + layout.size / 2);
    }
    return result;
  }, [layout, page]);
  // The labels change with the fingers, not with the cursor, so moving the cursor redraws
  // only the ring and the band.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const pick = useCallback((id: string) => {
    const current = editorRef.current;
    if (current.cursor?.id === id) current.togglePicker();
    else current.select(id);
  }, []);
  const hover = useCallback((id: string | null) => editorRef.current.hover(id), []);
  // The ringed note has the cursor's ring, so the pointer over it adds none.
  const hoverId = editor.hoverId !== editor.cursor?.id ? editor.hoverId : null;
  const printedTargets = useMemo(() => [...notes.values()].flatMap((note) => {
    const fingering = fingerings?.[prefix + note.key];
    // A note following another, held by a tie or sharing a voice's notehead, has its digit
    // too: clicking it reaches the key, and changing the key's finger strikes it.
    return note.printedFingering && fingering?.basePrinted ? [{ note, fingering }] : [];
  }), [fingerings, notes, prefix]);
  // Notes the player moved to the other hand, held ones included: their heads stay black,
  // ringed with a dashed line in their hand's colour, so that colour on a head means the
  // ringed note alone.
  const movedHeads = useMemo(() => [...notes.values()].flatMap((note) => {
    const fingering = fingerings?.[prefix + note.key];
    return fingering?.handMoved ? [{ note, left: fingering.left }] : [];
  }), [fingerings, notes, prefix]);
  const marks = useMemo(() => {
    if (!fingerings) return null;
    const radius = layout.size / 2;
    return (
      <>
        {layout.stacks.map((stack) => (
          <rect
            key={stack.id}
            className={`fingering-stack ${handClass(stack.left)}`}
            x={stack.x - radius - layout.size * 0.12}
            y={stack.top - layout.size * 0.12}
            width={layout.size * 1.24}
            height={stack.bottom - stack.top + layout.size * 0.24}
            rx={radius + layout.size * 0.12}
          />
        ))}
        {movedHeads.map(({ note, left }) => {
          const [x1, y1, x2, y2] = note.headBounds;
          return (
            <ellipse
              key={`moved-${note.key}`}
              className={`fingering-moved-head ${handClass(left)}`}
              cx={(x1 + x2) / 2}
              cy={(y1 + y2) / 2}
              rx={(x2 - x1) / 2 + MOVED_RING_GAP * page.staffSpace}
              ry={(y2 - y1) / 2 + MOVED_RING_GAP * page.staffSpace}
              strokeWidth={layout.size * 0.08}
              strokeDasharray={`${0.36 * page.staffSpace} ${0.22 * page.staffSpace}`}
            />
          );
        })}
        {printedTargets.map(({ note, fingering }) => {
          const id = prefix + note.key;
          const [left, top, right, bottom] = note.printedFingering!;
          const replaced = printedFingerReplaced(fingering);
          return (
            <g key={`printed-${note.key}`}>
              {/* Struck or not, the digit is a way to its note, wherever its label now stands. */}
              <rect
                className={`fingering-printed ${handClass(fingering.left)}${hoverId === id ? " hovered" : ""}`}
                x={left - layout.size * 0.1}
                y={top - layout.size * 0.1}
                width={right - left + layout.size * 0.2}
                height={bottom - top + layout.size * 0.2}
                rx={layout.size * 0.15}
                role="button"
                aria-label={`${replaced ? "Printed finger, replaced: " : ""}${labelText(id, fingering, note.pitch)}`}
                onPointerDown={stop}
                onPointerMove={stop}
                onPointerEnter={() => hover(id)}
                onPointerLeave={() => hover(null)}
                onClick={() => pick(id)}
              />
              {replaced ? (
                <line
                  className="fingering-printed-strike"
                  x1={left}
                  x2={right}
                  y1={(top + bottom) / 2}
                  y2={(top + bottom) / 2}
                  strokeWidth={layout.size * 0.06}
                />
              ) : null}
            </g>
          );
        })}
        {layout.labels.map((label) => {
          const id = prefix + label.key;
          const fingering = fingerings[id];
          return (
            <FingeringLabel
              key={label.key}
              id={id}
              x={label.x}
              y={label.y}
              size={layout.size}
              left={label.left}
              finger={fingering.finger}
              look={labelLook(fingering, hands.get(label.key))}
              text={labelText(id, fingering, notes.get(label.key)?.pitch ?? null)}
              onPick={pick}
              onHover={hover}
            />
          );
        })}
      </>
    );
  }, [fingerings, hands, hover, hoverId, layout, movedHeads, notes, page.staffSpace, pick, prefix, printedTargets]);
  // Where this page stands among the pages, for the picker drawn over it: measured once per
  // layout and page size, not on every move of the cursor.
  const markerRef = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState<PageFrame | null>(null);
  useLayoutEffect(() => {
    const page = markerRef.current?.closest<HTMLElement>(".document-page");
    const host = page?.parentElement;
    if (!page || !host) return;
    const pageBox = page.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const zoom = page.offsetWidth > 0 ? pageBox.width / page.offsetWidth : 1;
    setFrame({
      host,
      page,
      left: (pageBox.left - hostBox.left) / zoom,
      top: (pageBox.top - hostBox.top) / zoom,
      width: page.offsetWidth,
      height: page.offsetHeight,
    });
  }, [page, displayWidth, editor.editing]);
  if (!editor.editing || !fingerings) return null;

  const cursorId = editor.cursor?.id ?? null;
  const radius = layout.size / 2;
  const cursorLabel = layout.labels.find((label) => prefix + label.key === cursorId);
  const cursorPrinted = printedTargets.find(({ note }) => prefix + note.key === cursorId && !cursorLabel);
  const cursorFingering = cursorId ? fingerings[cursorId] : undefined;
  // The ring around the cursor's label, which slides from note to note: `r` is its radius,
  // and `w` half its width, wider round a printed row of digits, such as an ornament's.
  let ring: { x: number; y: number; r: number; w: number; left: boolean } | null = null;
  if (cursorLabel) {
    const r = radius + layout.size * 0.2;
    ring = { x: cursorLabel.x, y: cursorLabel.y, r, w: r, left: cursorLabel.left };
  } else if (cursorPrinted) {
    const [left, top, right, bottom] = cursorPrinted.note.printedFingering!;
    const r = radius + layout.size * 0.2;
    ring = {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      r,
      w: Math.max(radius, (right - left) / 2 + layout.size * 0.1) + layout.size * 0.2,
      left: cursorPrinted.fingering.left,
    };
  }
  // The note the pointer is over: the cursor's ring, in its hand's lighter colour, over the
  // labels as the cursor's is. Inside it the page is white, so that neither a chord's outline
  // nor its next label shows between the ring and the label, which is drawn again on top.
  // Where it meets the cursor's ring, as in a chord, the cursor's stays in front, whole.
  const hovered = hoverId ? layout.labels.find((label) => prefix + label.key === hoverId) : undefined;
  const hoveredFingering = hovered ? fingerings[prefix + hovered.key] : undefined;
  let hoverRing: ReactNode = null;
  if (hovered && hoveredFingering) {
    const outer = radius + layout.size * 0.2;
    const ringWidth = layout.size * 0.1;
    const cut = ring && Math.hypot(ring.x - hovered.x, ring.y - hovered.y) < ring.r + outer ? ring : null;
    const maskId = `fingering-hover-cut-${page.index}`;
    hoverRing = (
      <g mask={cut ? `url(#${maskId})` : undefined} aria-hidden="true">
        {cut ? (
          <mask id={maskId} maskUnits="userSpaceOnUse" x={hovered.x - outer} y={hovered.y - outer} width={outer * 2} height={outer * 2}>
            <rect x={hovered.x - outer} y={hovered.y - outer} width={outer * 2} height={outer * 2} fill="#fff" />
            <circle cx={cut.x} cy={cut.y} r={cut.r} fill="#000" />
          </mask>
        ) : null}
        <g className={`fingering-hover ${handClass(hovered.left)}`} transform={`translate(${hovered.x} ${hovered.y})`}>
          <circle className="fingering-hover-ground" r={outer} />
          <g
            className={`fingering-label ${handClass(hovered.left)} ${labelLook(hoveredFingering, hands.get(hovered.key))}`}
            // Only the label underneath takes the pointer, so the hover holds while it is there.
            style={{ pointerEvents: "none" }}
          >
            <LabelFace size={layout.size} finger={hoveredFingering.finger} look={labelLook(hoveredFingering, hands.get(hovered.key))} />
          </g>
          <circle className="fingering-hover-ring" r={outer - ringWidth / 2} strokeWidth={ringWidth} />
        </g>
      </g>
    );
  }
  let band: { x: number; y: number; width: number; height: number } | null = null;
  const cursorChord = editor.cursor && editor.cursor.pageIndex === page.index ? chordOf.get(editor.cursor.key) : undefined;
  const reach = cursorChord ? systemReach.get(cursorChord.systemIndex) : undefined;
  if (cursorChord && reach) {
    // Centred on the whole moment, not on the ringed note, so it holds still while the ring
    // moves between the moment's notes; it widens only for a moment whose labels spread
    // further than it.
    const labelPrefix = `${cursorChord.systemIndex}|${cursorChord.momentId}|`;
    const momentLabels = layout.labels.filter((label) => label.stackId.startsWith(labelPrefix));
    const momentChords = page.chords.filter((chord) => chord.systemIndex === cursorChord.systemIndex && chord.momentId === cursorChord.momentId);
    const xs = momentLabels.length
      ? momentLabels.map((label) => label.x)
      : momentChords.flatMap((chord) => chord.notes.map((note) => note.center[0]));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const width = Math.max(layout.size * 1.5, right - left + layout.size * 1.3);
    const pad = page.staffSpace * 0.6;
    band = { x: (left + right) / 2 - width / 2, y: reach.top - pad, width, height: reach.bottom - reach.top + 2 * pad };
  }
  // The picker stands outside the system, its caret pointing at the ringed label. In a
  // chord's stack it stands beside the stack, and a line runs from its caret down the
  // stack's side and turns in at the ringed digit.
  let anchor: { x: number; y: number; above: boolean } | null = null;
  let lead: { x: number; from: number; to: number; tickTo: number } | null = null;
  if (cursorLabel) {
    // The hand's labels at the moment: its chord's stack and, each apart outside its outline,
    // other voices' chords and the notes moved to that hand. The picker stands beyond them all.
    const column = labelColumn(cursorLabel.stackId);
    const group = layout.labels.filter((label) => labelColumn(label.stackId) === column);
    const members = new Set(group.map((label) => label.stackId));
    const outlined = layout.stacks.find((candidate) => candidate.id === cursorLabel.stackId) ??
      layout.stacks.find((candidate) => members.has(candidate.id));
    const stack = group.length > 1
      ? {
        x: outlined?.x ?? cursorLabel.x,
        top: Math.min(...group.map((label) => label.y - radius)),
        bottom: Math.max(...group.map((label) => label.y + radius)),
      }
      : undefined;
    const above = !cursorLabel.left;
    if (stack) {
      const y = above ? stack.top - layout.size * 0.12 - radius * 0.6 : stack.bottom + layout.size * 0.12 + radius * 0.6;
      // The line runs down whichever side of the stack is clear of other labels and stacks,
      // the right first; with neither clear, the caret points at the stack and the ring alone
      // marks the note.
      const clear = (x: number) => {
        const left = x - layout.size * 0.15;
        const right = x + layout.size * 0.15;
        const top = Math.min(y, cursorLabel.y);
        const bottom = Math.max(y, cursorLabel.y);
        const labelInWay = layout.labels.some((label) => !members.has(label.stackId) &&
          label.x + radius > left && label.x - radius < right && label.y + radius > top && label.y - radius < bottom);
        const stackInWay = layout.stacks.some((other) => !members.has(other.id) &&
          other.x + layout.size * 0.62 > left && other.x - layout.size * 0.62 < right &&
          other.bottom + layout.size * 0.12 > top && other.top - layout.size * 0.12 < bottom);
        return !labelInWay && !stackInWay;
      };
      const side = [1, -1].find((direction) => clear(stack.x + direction * layout.size * 0.95));
      if (side === undefined) {
        anchor = { x: stack.x, y, above };
      } else {
        const x = stack.x + side * layout.size * 0.95;
        anchor = { x, y, above };
        lead = { x, from: y, to: cursorLabel.y, tickTo: cursorLabel.x + side * (radius + layout.size * 0.08) };
      }
    }
  }
  if (!anchor && ring) {
    // A single label: the caret's tip touches the ring's outer edge. The caret reaches half
    // its 10-pixel square's diagonal past the picker, a size on screen, not on the page.
    const reach = ring.r + (5 * Math.SQRT2) / (scale * (displayWidth / page.width));
    anchor = ring.left
      ? { x: ring.x, y: ring.y + reach, above: false }
      : { x: ring.x, y: ring.y - reach, above: true };
  }

  // What moves is drawn in HTML on layers of its own, so the browser slides it without
  // painting the page again; inside the labels' SVG, every frame of a move would make it
  // lay out the whole engraved page anew.
  const k = displayWidth / page.width;
  const pops = editor.flash.ids.flatMap((id) => {
    const label = layout.labels.find((candidate) => prefix + candidate.key === id);
    const fingering = fingerings[id];
    return label && fingering ? [{ id, label, fingering }] : [];
  });
  return (
    <>
      <span ref={markerRef} hidden />
      {band ? (
        <div
          className="fingering-band"
          aria-hidden="true"
          style={{
            width: band.width * k,
            height: band.height * k,
            borderRadius: page.staffSpace * 0.8 * k,
            transform: `translate3d(${band.x * k}px, ${band.y * k}px, 0)`,
          }}
        />
      ) : null}
      <svg
        className="fingering-layer"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="none"
        aria-label="Fingerings"
      >
        {marks}
        {hoverRing}
      </svg>
      {pops.map(({ id, label, fingering }) => (
        <div
          key={`${id}-${editor.flash.serial}`}
          className={`fingering-pop ${handClass(label.left)} ${labelLook(fingering, hands.get(label.key))}`}
          aria-hidden="true"
          style={{
            width: layout.size * k,
            height: layout.size * k,
            borderWidth: layout.size * 0.08 * k,
            fontSize: layout.size * 0.62 * k,
            ["--at" as string]: `translate3d(${(label.x - radius) * k}px, ${(label.y - radius) * k}px, 0)`,
          }}
        >
          {fingering.finger}
        </div>
      ))}
      {ring ? (
        <div
          className={`fingering-ring ${handClass(ring.left)}`}
          aria-hidden="true"
          style={{
            width: ring.w * 2 * k,
            height: ring.r * 2 * k,
            borderRadius: ring.r * k,
            borderWidth: layout.size * 0.1 * k,
            transform: `translate3d(${(ring.x - ring.w) * k}px, ${(ring.y - ring.r) * k}px, 0)`,
          }}
        />
      ) : null}
      {editor.pickerOpen && anchor && cursorFingering && lead ? (
        <>
          <div
            className="finger-picker-lead"
            aria-hidden="true"
            style={{
              left: lead.x * k - 0.75 / scale,
              top: Math.min(lead.from, lead.to) * k,
              width: 1.5 / scale,
              height: Math.abs(lead.to - lead.from) * k,
            }}
          />
          <div
            className="finger-picker-lead"
            aria-hidden="true"
            style={{
              left: Math.min(lead.x, lead.tickTo) * k - (lead.x < lead.tickTo ? 0.75 / scale : 0),
              top: lead.to * k - 0.75 / scale,
              width: Math.abs(lead.x - lead.tickTo) * k + 0.75 / scale,
              height: 1.5 / scale,
            }}
          />
        </>
      ) : null}
      {editor.pickerOpen && anchor && cursorFingering && frame ? (
        <FingerPicker
          editor={editor}
          fingering={cursorFingering}
          anchor={anchor}
          above={anchor.above}
          scale={scale}
          pageWidth={page.width}
          pageHeight={page.height}
          frame={frame}
          reveal={reveal}
        />
      ) : null}
    </>
  );
});

/** What the ringed note is and who decided its finger, with the editor's keys. */
export function FingeringStatusStrip({
  editor,
  shortcuts,
}: {
  editor: FingeringEditor;
  shortcuts: PlaybackShortcuts;
}) {
  const [keysOpen, setKeysOpen] = useState(false);
  const keysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!keysOpen) return;
    function close(event: PointerEvent) {
      if (event.target instanceof Node && keysRef.current?.contains(event.target)) return;
      setKeysOpen(false);
    }
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [keysOpen]);
  if (!editor.editing) return null;
  const cursor = editor.cursor;
  const fingering = cursor ? editor.fingerings?.[cursor.id] : undefined;
  let status = "";
  if (fingering) {
    const base = fingering.basePrinted ? `printed ${fingering.baseFinger}` : `predicted ${fingering.baseFinger}`;
    status = fingering.source === "yours"
      ? `Your finger ${fingering.finger} (${base})`
      : fingering.source === "printed"
        ? `Finger ${fingering.finger}, printed in the score`
        : `Finger ${fingering.finger}, the model’s suggestion`;
    if (fingering.handMoved) status += ` · you moved it to the ${fingering.left ? "left" : "right"} hand`;
  }
  const chord = cursor && fingering
    ? editor.momentNotes.filter((target) => editor.fingerings?.[target.id]?.left === fingering.left)
    : [];
  const place = cursor ? chord.findIndex((target) => target.id === cursor.id) : -1;
  // The player's fingerings: how many, which of them is selected, and a way through them.
  const yours = editor.overrides.length;
  const yourPlace = cursor ? editor.overrides.findIndex((target) => target.key === cursor.key) : -1;
  const keys: [string, string][] = [
    [[1, 2, 3, 4, 5].map((finger) => keyName(shortcuts, `setFinger${finger}` as PlaybackCommand)).join(" "), "Set finger, go to the next note"],
    [keyName(shortcuts, "resetFinger"), "Back to the printed or predicted finger, next note"],
    [keyName(shortcuts, "swapFingerHand"), "Move the note to the other hand"],
    [keyName(shortcuts, "undoFingerEdit"), "Undo"],
    [`${keyName(shortcuts, "previousOverride")} · ${keyName(shortcuts, "nextOverride")}`, "Previous / next of your fingerings"],
    [`${keyName(shortcuts, "backwardNote")} · ${keyName(shortcuts, "forwardNote")}`, "Previous / next note"],
    [`${keyName(shortcuts, "fingerNoteHigher")} · ${keyName(shortcuts, "fingerNoteLower")}`, "Higher / lower note at the same time"],
    [`${keyName(shortcuts, "backwardBar")} · ${keyName(shortcuts, "forwardBar")}`, "Previous / next bar"],
    [`${keyName(shortcuts, "backwardSystem")} · ${keyName(shortcuts, "forwardSystem")}`, "The note above / below, in the system before or after"],
    [keyName(shortcuts, "playCurrentNotes"), "Hear the notes at the selected note"],
    ["Ctrl + V", "Paste a run of fingers, such as 54545243"],
    [`${keyName(shortcuts, "toggleFingerEditing")} · Esc`, "Back to what was playing, at the selected note"],
  ];
  return (
    <section className="fingering-status" aria-label="Selected note">
      {cursor && fingering ? (
        <>
          <span className="fingering-status-where">
            {cursor.measure === null ? "" : `Bar ${cursor.measure}`}
          </span>
          <span aria-hidden="true">·</span>
          <strong>{cursor.pitch.replace("#", "♯")}</strong>
          <span className={`fingering-status-hand ${handClass(fingering.left)}`}>
            {fingering.left ? "Left hand" : "Right hand"}
          </span>
          {chord.length > 1 ? <span className="fingering-status-place">note {place + 1} of {chord.length}</span> : null}
          <span aria-hidden="true">·</span>
          <span>{status}</span>
        </>
      ) : (
        <span>No fingered note at the playhead.</span>
      )}
      {yours ? (
        <span className="fingering-summary fingering-yours" role="group" aria-label="Your fingerings">
          <button
            type="button"
            aria-label="Previous of your fingerings"
            title={`Previous of your fingerings (${keyName(shortcuts, "previousOverride")})`}
            onClick={() => editor.stepOverride(-1)}
          >‹</button>
          {/* As wide as its widest wording, so that the buttons hold still as it changes. */}
          <span className="fingering-yours-text">
            <span aria-hidden="true">{`Your fingering ${yours} of ${yours}`}</span>
            <span aria-hidden="true">{`${yours} of your fingering${yours === 1 ? "" : "s"}`}</span>
            <span role="status">
              {yourPlace >= 0 ? `Your fingering ${yourPlace + 1} of ${yours}` : `${yours} of your fingering${yours === 1 ? "" : "s"}`}
            </span>
          </span>
          <button
            type="button"
            aria-label="Next of your fingerings"
            title={`Next of your fingerings (${keyName(shortcuts, "nextOverride")})`}
            onClick={() => editor.stepOverride(1)}
          >›</button>
        </span>
      ) : (
        <span className="fingering-summary" role="status">Showing the model’s fingerings</span>
      )}
      {editor.unsavedReason ? (
        <span className="fingering-status-warning" title={editor.unsavedReason}>Edits are not being saved</span>
      ) : null}
      <div ref={keysRef} className="fingering-keys">
        <button
          type="button"
          aria-expanded={keysOpen}
          aria-haspopup="dialog"
          className={keysOpen ? "active" : ""}
          onClick={() => setKeysOpen((open) => !open)}
        >Keys</button>
        {keysOpen ? (
          <div className="fingering-keys-popover" role="dialog" aria-label="Keys in edit mode">
            {keys.map(([key, description]) => (
              <div key={description} className="fingering-keys-row">
                <kbd>{key}</kbd>
                <span>{description}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
