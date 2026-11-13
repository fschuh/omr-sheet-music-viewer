// The fingering editor's views: its toolbar controls, the labels it draws over an engraved
// page with the finger picker, and the strip describing the ringed note. Shape tells the
// layers apart rather than hue, so it survives custom hand colours and colour blindness:
// a predicted finger is an outline in its hand's colour, the player's own is filled, and a
// printed one stays the score's own digit.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FingeringEditor } from "./fingeringEditor";
import { fingeringLabelLayout, type EffectiveFingering, type MusicXmlPage } from "./musicxml";
import { formatKeyboardShortcut, type PlaybackShortcuts } from "./shortcuts";
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
          ? `Back to playback at the ringed note (${toggleKey} or Esc)`
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

/** The finger picker, standing just outside the ringed note's label. */
function FingerPicker({
  editor,
  fingering,
  anchor,
  above,
  scale,
  pageWidth,
  pageHeight,
}: {
  editor: FingeringEditor;
  fingering: EffectiveFingering;
  anchor: { x: number; y: number };
  above: boolean;
  scale: number;
  pageWidth: number;
  pageHeight: number;
}) {
  const cursor = editor.cursor!;
  const chord = editor.momentNotes.filter((target) => editor.fingerings?.[target.id]?.left === fingering.left);
  const place = chord.findIndex((target) => target.id === cursor.id);
  const other = fingering.left ? "right" : "left";
  const resetLabel = fingering.basePrinted ? "Use the printed finger" : "Use the predicted finger";
  const hasOverride = fingering.source === "yours" || fingering.handMoved;
  return (
    <div
      className={`finger-picker ${handClass(fingering.left)}${above ? " above" : " below"}`}
      role="group"
      aria-label={`Finger for ${cursor.pitch}`}
      style={{
        left: `${(anchor.x / pageWidth) * 100}%`,
        top: `${(anchor.y / pageHeight) * 100}%`,
        transform: `translate(-50%, ${above ? "-100%" : "0"}) scale(${1 / scale})`,
        transformOrigin: above ? "50% 100%" : "50% 0",
      }}
      onPointerDown={stop}
    >
      {chord.length > 1 ? (
        <div className="finger-picker-chord" role="group" aria-label="Move within the chord">
          <button
            type="button"
            aria-label="Higher note of the chord"
            disabled={place <= 0}
            onClick={() => editor.moveInMoment(-1)}
          >▲</button>
          <button
            type="button"
            aria-label="Lower note of the chord"
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
        return (
          <button
            key={finger}
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
        onClick={editor.reset}
      >↺</button>
    </div>
  );
}

/** One finger label. Its props are plain values, so an edit redraws only the labels it changes. */
const FingeringLabel = memo(function FingeringLabel({
  id, x, y, size, left, finger, yours, text, onPick,
}: {
  id: string;
  x: number;
  y: number;
  size: number;
  left: boolean;
  finger: number;
  yours: boolean;
  text: string;
  onPick: (id: string) => void;
}) {
  return (
    <g
      className={`fingering-label ${handClass(left)} ${yours ? "yours" : "predicted"}`}
      transform={`translate(${x} ${y})`}
      role="button"
      aria-label={text}
      onPointerDown={stop}
      onClick={() => onPick(id)}
    >
      <g className="fingering-label-body">
        <circle r={size / 2 - size * 0.04} strokeWidth={size * 0.08} />
        <text dy="0.36em" fontSize={size * 0.62}>{finger}</text>
      </g>
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
}: {
  page: MusicXmlPage;
  editor: FingeringEditor;
  scale: number;
  /** The page's width on screen before zooming, which the moving marks are placed in. */
  displayWidth: number;
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
  const hands = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const key of notes.keys()) {
      const fingering = fingerings?.[prefix + key];
      // A held note is played by the finger holding it, which its tie's first note shows.
      if (!fingering || fingering.tiedTo) continue;
      // A printed finger the player kept is the score's own digit, not a label.
      if (fingering.source === "printed" && notes.get(key)?.printedFingering) continue;
      result.set(key, fingering.left);
    }
    return result;
  }, [fingerings, notes, prefix]);
  const handsSignature = useMemo(
    () => [...hands].map(([key, left]) => `${key}:${left ? "L" : "R"}`).join("|"),
    [hands],
  );
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const layout = useMemo(
    () => fingeringLabelLayout(page, (key) => handsRef.current.get(key)),
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
  const printedTargets = useMemo(() => [...notes.values()].flatMap((note) => {
    const fingering = fingerings?.[prefix + note.key];
    return note.printedFingering && fingering?.basePrinted && !fingering.tiedTo ? [{ note, fingering }] : [];
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
        {printedTargets.map(({ note, fingering }) => {
          const id = prefix + note.key;
          const [left, top, right, bottom] = note.printedFingering!;
          const replaced = fingering.source === "yours";
          return (
            <g key={`printed-${note.key}`}>
              {replaced ? (
                <line
                  className="fingering-printed-strike"
                  x1={left}
                  x2={right}
                  y1={(top + bottom) / 2}
                  y2={(top + bottom) / 2}
                  strokeWidth={layout.size * 0.06}
                />
              ) : (
                <rect
                  className={`fingering-printed ${handClass(fingering.left)}`}
                  x={left - layout.size * 0.1}
                  y={top - layout.size * 0.1}
                  width={right - left + layout.size * 0.2}
                  height={bottom - top + layout.size * 0.2}
                  rx={layout.size * 0.15}
                  role="button"
                  aria-label={labelText(id, fingering, note.pitch)}
                  onPointerDown={stop}
                  onClick={() => pick(id)}
                />
              )}
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
              yours={fingering.source === "yours"}
              text={labelText(id, fingering, notes.get(label.key)?.pitch ?? null)}
              onPick={pick}
            />
          );
        })}
      </>
    );
  }, [fingerings, layout, notes, pick, prefix, printedTargets]);
  if (!editor.editing || !fingerings) return null;

  const cursorId = editor.cursor?.id ?? null;
  const radius = layout.size / 2;
  const cursorLabel = layout.labels.find((label) => prefix + label.key === cursorId);
  const cursorPrinted = printedTargets.find(({ note }) => prefix + note.key === cursorId && !cursorLabel);
  const cursorFingering = cursorId ? fingerings[cursorId] : undefined;
  // The ring around the cursor's label, which slides from note to note.
  let ring: { x: number; y: number; r: number; left: boolean } | null = null;
  if (cursorLabel) ring = { x: cursorLabel.x, y: cursorLabel.y, r: radius + layout.size * 0.2, left: cursorLabel.left };
  else if (cursorPrinted) {
    const [left, top, right, bottom] = cursorPrinted.note.printedFingering!;
    ring = {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      r: Math.max(radius, (right - left) / 2) + layout.size * 0.2,
      left: cursorPrinted.fingering.left,
    };
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
  let anchor: { x: number; y: number; above: boolean } | null = null;
  if (cursorLabel) {
    const stack = layout.stacks.find((candidate) => candidate.id === cursorLabel.stackId);
    anchor = cursorLabel.left
      ? { x: cursorLabel.x, y: (stack?.bottom ?? cursorLabel.y + radius) + radius * 0.6, above: false }
      : { x: cursorLabel.x, y: (stack?.top ?? cursorLabel.y - radius) - radius * 0.6, above: true };
  } else if (cursorPrinted) {
    const [left, top, right, bottom] = cursorPrinted.note.printedFingering!;
    anchor = cursorPrinted.fingering.left
      ? { x: (left + right) / 2, y: bottom + radius * 0.6, above: false }
      : { x: (left + right) / 2, y: top - radius * 0.6, above: true };
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
      </svg>
      {pops.map(({ id, label, fingering }) => (
        <div
          key={`${id}-${editor.flash.serial}`}
          className={`fingering-pop ${handClass(label.left)} ${fingering.source === "yours" ? "yours" : "predicted"}`}
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
            width: ring.r * 2 * k,
            height: ring.r * 2 * k,
            borderWidth: layout.size * 0.1 * k,
            transform: `translate3d(${(ring.x - ring.r) * k}px, ${(ring.y - ring.r) * k}px, 0)`,
          }}
        />
      ) : null}
      {editor.pickerOpen && anchor && cursorFingering ? (
        <FingerPicker
          editor={editor}
          fingering={cursorFingering}
          anchor={anchor}
          above={anchor.above}
          scale={scale}
          pageWidth={page.width}
          pageHeight={page.height}
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
  const keys: [string, string][] = [
    [[1, 2, 3, 4, 5].map((finger) => keyName(shortcuts, `setFinger${finger}` as PlaybackCommand)).join(" "), "Set finger, go to the next note"],
    [keyName(shortcuts, "resetFinger"), "Back to the printed or predicted finger, next note"],
    [keyName(shortcuts, "swapFingerHand"), "Move the note to the other hand"],
    [keyName(shortcuts, "undoFingerEdit"), "Undo"],
    [`${keyName(shortcuts, "backwardNote")} · ${keyName(shortcuts, "forwardNote")}`, "Previous / next note"],
    [`${keyName(shortcuts, "fingerNoteHigher")} · ${keyName(shortcuts, "fingerNoteLower")}`, "Higher / lower note at the same time"],
    [`${keyName(shortcuts, "backwardBar")} · ${keyName(shortcuts, "forwardBar")}`, "Previous / next bar"],
    [keyName(shortcuts, "playCurrentNotes"), "Hear the notes at the ring"],
    ["Ctrl + V", "Paste a run of fingers, such as 54545243"],
    [`${keyName(shortcuts, "toggleFingerEditing")} · Esc`, "Back to what was playing, at the ring; Esc first closes the picker"],
  ];
  return (
    <section className="fingering-status" aria-label="Ringed note">
      {cursor && fingering ? (
        <>
          <span className="fingering-status-where">
            {cursor.measure === null ? "" : `Bar ${cursor.measure}`}
            {chord.length > 1 ? ` · chord note ${place + 1} of ${chord.length}, top down` : ""}
          </span>
          <span aria-hidden="true">·</span>
          <strong>{cursor.pitch.replace("#", "♯")}</strong>
          <span className={`fingering-status-hand ${handClass(fingering.left)}`}>
            {fingering.left ? "Left hand" : "Right hand"}
          </span>
          <span aria-hidden="true">·</span>
          <span>{status}</span>
        </>
      ) : (
        <span>No fingered note at the playhead.</span>
      )}
      <span className="fingering-summary" role="status">
        {editor.overrideCount
          ? `${editor.overrideCount} of your fingering${editor.overrideCount === 1 ? "" : "s"}`
          : "Showing the model’s fingerings"}
      </span>
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
