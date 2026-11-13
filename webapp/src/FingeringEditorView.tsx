// The fingering editor's views: its toolbar controls, the labels it draws over an engraved
// page with the finger picker, and the strip describing the ringed note. Shape tells the
// layers apart rather than hue, so it survives custom hand colours and colour blindness:
// a predicted finger is an outline in its hand's colour, the player's own is filled, and a
// printed one stays the score's own digit.
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FingeringEditor } from "./fingeringEditor";
import { fingeringLabelLayout, type EffectiveFingering, type MusicXmlPage } from "./musicxml";
import type { PlaybackMode } from "./realtime";
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
  playbackMode,
  shortcuts,
}: {
  editor: FingeringEditor;
  playbackMode: PlaybackMode;
  shortcuts: PlaybackShortcuts;
}) {
  if (!editor.available) return null;
  const toggleKey = keyName(shortcuts, "toggleFingerEditing");
  const realtime = playbackMode === "realtime";
  return (
    <div className="fingering-toolbar" role="group" aria-label="Fingering editor">
      <button
        type="button"
        className={`fingering-edit-toggle${editor.editing ? " active" : ""}`}
        aria-pressed={editor.editing}
        disabled={realtime && !editor.editing}
        title={realtime
          ? "Switch to note-by-note to edit fingers"
          : editor.editing
            ? `Stop editing fingers (${toggleKey} or Esc)`
            : `Edit the fingers of the notes as you step through them (${toggleKey})`}
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
          <span className="fingering-summary" role="status">
            {editor.overrideCount
              ? `${editor.overrideCount} of your fingering${editor.overrideCount === 1 ? "" : "s"}`
              : "Showing the model’s fingerings"}
            {editor.unsavedReason ? " · not saved" : ""}
          </span>
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

/**
 * The fingering labels of one engraved page while editing, with the finger picker of the
 * ringed note when it is on this page.
 */
export const FingeringPageLayer = memo(function FingeringPageLayer({
  page,
  editor,
  scale,
}: {
  page: MusicXmlPage;
  editor: FingeringEditor;
  scale: number;
}) {
  const fingerings = editor.fingerings;
  const prefix = `page-${page.index + 1}-`;
  const notes = useMemo(
    () => new Map(page.chords.flatMap((chord) => chord.notes.map((note) => [note.key, note] as const))),
    [page],
  );
  // Where labels go depends only on which notes have one and on which hand, so a new finger
  // does not place the page's labels again.
  const hands = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const key of notes.keys()) {
      const fingering = fingerings?.[prefix + key];
      if (!fingering) continue;
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
  if (!editor.editing || !fingerings) return null;

  const cursorId = editor.cursor?.id ?? null;
  const flashing = new Set(editor.flash.ids);
  const radius = layout.size / 2;
  const printedTargets = [...notes.values()].flatMap((note) => {
    const fingering = fingerings[prefix + note.key];
    return note.printedFingering && fingering?.basePrinted ? [{ note, fingering }] : [];
  });
  const cursorLabel = layout.labels.find((label) => prefix + label.key === cursorId);
  const cursorPrinted = printedTargets.find(({ note }) => prefix + note.key === cursorId && !cursorLabel);
  const cursorFingering = cursorId ? fingerings[cursorId] : undefined;
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

  return (
    <>
      <svg
        className="fingering-layer"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="none"
        aria-label="Fingerings"
      >
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
                  className={`fingering-printed${id === cursorId ? " current" : ""} ${handClass(fingering.left)}`}
                  x={left - layout.size * 0.1}
                  y={top - layout.size * 0.1}
                  width={right - left + layout.size * 0.2}
                  height={bottom - top + layout.size * 0.2}
                  rx={layout.size * 0.15}
                  role="button"
                  aria-label={labelText(id, fingering, note.pitch)}
                  onPointerDown={stop}
                  onClick={() => editor.select(id)}
                />
              )}
            </g>
          );
        })}
        {layout.labels.map((label) => {
          const id = prefix + label.key;
          const fingering = fingerings[id];
          const current = id === cursorId;
          const flash = flashing.has(id);
          return (
            <g
              key={flash ? `${label.key}-${editor.flash.serial}` : label.key}
              className={[
                "fingering-label",
                handClass(label.left),
                fingering.source === "yours" ? "yours" : "predicted",
                current ? "current" : "",
                flash ? "flash" : "",
              ].filter(Boolean).join(" ")}
              transform={`translate(${label.x} ${label.y})`}
              role="button"
              aria-label={labelText(id, fingering, notes.get(label.key)?.pitch ?? null)}
              aria-expanded={current && editor.pickerOpen}
              onPointerDown={stop}
              onClick={() => (current ? editor.togglePicker() : editor.select(id))}
            >
              {current ? <circle className="fingering-ring" r={radius + layout.size * 0.2} strokeWidth={layout.size * 0.1} /> : null}
              <g className="fingering-label-body">
                <circle r={radius - layout.size * 0.04} strokeWidth={layout.size * 0.08} />
                <text dy="0.36em" fontSize={layout.size * 0.62}>{fingering.finger}</text>
              </g>
            </g>
          );
        })}
      </svg>
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
    ["Ctrl + V", "Paste a run of fingers, such as 54545243"],
    [`${keyName(shortcuts, "toggleFingerEditing")} · Esc`, "Leave edit mode; Esc first closes the picker"],
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
