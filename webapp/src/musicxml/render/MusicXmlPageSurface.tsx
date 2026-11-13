import { memo, type ReactElement } from "react";
import { glyphText } from "../fonts/smufl";
import type { Drawable, LayoutChord, LayoutPage } from "../model/layout";

export const LELAND_URL = new URL("../fonts/Leland.otf", import.meta.url).href;
/** The page's own styles: the music font, and the colours shared with PDF highlighting. */
const PAGE_STYLE =
  `@font-face{font-family:"Leland";src:url("${LELAND_URL}") format("opentype");font-display:block}` +
  ".musicxml-page{color:#000}.musicxml-page line{stroke:currentColor}" +
  ".musicxml-page polygon,.musicxml-page path,.musicxml-page text{fill:currentColor}" +
  '.mx-glyph{font-family:"Leland"}.mx-text{font-family:Georgia,"Times New Roman",serif}' +
  ".mx-selected{color:#de3619}.mx-playback{color:#13a98d}" +
  // The note the fingering editor points at, in its hand's colour, with its chord's stem;
  // the chord's other notes stay black, so the note stands out within it.
  ".mx-left-hand{color:var(--hand-left,#f28c38)}.mx-right-hand{color:var(--hand-right,#2fbfa5)}" +
  ".mx-chord.mx-left-hand .mx-note:not(.mx-left-hand),.mx-chord.mx-right-hand .mx-note:not(.mx-right-hand){color:#000}";
/** SMuFL fonts are scaled so one em is four staff spaces. */
const EM_PER_STAFF_SPACE = 4;

export type HighlightKind = "selected" | "playback" | "left-hand" | "right-hand";

function draw(item: Drawable, staffSpace: number, key: number): ReactElement {
  switch (item.kind) {
    case "glyph": {
      const fontSize = EM_PER_STAFF_SPACE * staffSpace * item.scale;
      if (item.scaleY === undefined && item.rotate === undefined) {
        return <text key={key} className="mx-glyph" x={item.x} y={item.y} fontSize={fontSize}>{glyphText(item.glyph)}</text>;
      }
      const transform = [
        `translate(${item.x} ${item.y})`,
        item.rotate === undefined ? null : `rotate(${item.rotate})`,
        item.scaleY === undefined ? null : `scale(1 ${item.scaleY})`,
      ].filter(Boolean).join(" ");
      return (
        <text key={key} className="mx-glyph" fontSize={fontSize} transform={transform}>
          {glyphText(item.glyph)}
        </text>
      );
    }
    case "line":
      return (
        <line
          key={key}
          x1={item.x1}
          y1={item.y1}
          x2={item.x2}
          y2={item.y2}
          strokeWidth={item.width}
          strokeDasharray={item.dash?.join(" ")}
        />
      );
    case "polygon":
      return <polygon key={key} points={item.points.join(" ")} />;
    case "path":
      return <path key={key} d={item.d} />;
    case "text":
      return (
        <text key={key} className="mx-text" x={item.x} y={item.y} fontSize={item.size} textAnchor={item.anchor}>
          {item.runs
            ? item.runs.map((run, index) => (
                <tspan
                  key={index}
                  fontSize={run.size}
                  fontStyle={run.italic ? "italic" : undefined}
                  fontWeight={run.bold ? "bold" : undefined}
                >
                  {run.text}
                </tspan>
              ))
            : item.text}
        </text>
      );
  }
}

const Chord = memo(function Chord({
  chord,
  staffSpace,
  highlighted,
  kind,
}: {
  chord: LayoutChord;
  staffSpace: number;
  /** The chord's highlighted note keys, joined; empty when none is. */
  highlighted: string;
  kind: HighlightKind;
}) {
  const keys = new Set(highlighted ? highlighted.split(" ") : []);
  // Highlighted notes come last, in front of the chord's others where they touch.
  const notes = keys.size === 0
    ? chord.notes
    : [...chord.notes.filter((note) => !keys.has(note.key)), ...chord.notes.filter((note) => keys.has(note.key))];
  return (
    <g className={`mx-chord${keys.size ? ` mx-${kind}` : ""}`} data-chord={chord.id}>
      {chord.items.map((item, index) => draw(item, staffSpace, index))}
      {notes.map((note) => (
        <g key={note.key} className={`mx-note${keys.has(note.key) ? ` mx-${kind}` : ""}`} data-notehead={note.key}>
          {note.items.map((item, index) => draw(item, staffSpace, index))}
        </g>
      ))}
    </g>
  );
});

/**
 * One engraved page as SVG, in page pixels like a PDF page's image. Highlighted noteheads
 * are drawn in the highlight colour together with their accidentals and dots, and their
 * chord's stem and flag, and in front of any chord that touches them.
 */
export const MusicXmlPageSurface = memo(function MusicXmlPageSurface({
  page,
  highlighted = new Set<string>(),
  highlightKind = "selected",
}: {
  page: LayoutPage;
  /** Note keys to highlight. */
  highlighted?: ReadonlySet<string>;
  highlightKind?: HighlightKind;
}) {
  const isHighlighted = (chord: LayoutChord) => chord.notes.some((note) => highlighted.has(note.key));
  // SVG paints in order: highlighted chords last, over neighbours that touch them. The
  // fingering editor's note changes only colour, so moving it on each step does not make
  // the browser lay out the whole page again.
  const chords = highlighted.size === 0 || highlightKind === "left-hand" || highlightKind === "right-hand"
    ? page.chords
    : [...page.chords.filter((chord) => !isHighlighted(chord)), ...page.chords.filter(isHighlighted)];
  return (
    <svg
      className="musicxml-page"
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sheet music page ${page.index + 1}`}
    >
      <style>{PAGE_STYLE}</style>
      <rect width={page.width} height={page.height} fill="#fff" />
      <g className="mx-static">{page.items.map((item, index) => draw(item, page.staffSpace, index))}</g>
      {chords.map((chord) => (
        <Chord
          key={chord.id}
          chord={chord}
          staffSpace={page.staffSpace}
          highlighted={chord.notes.filter((note) => highlighted.has(note.key)).map((note) => note.key).join(" ")}
          kind={highlightKind}
        />
      ))}
    </svg>
  );
});

/**
 * Notes of a page drawn again on their own, coloured `kind`, with their chords' stems: laid
 * over the page, they highlight it without changing it.
 */
export const MusicXmlNoteMarks = memo(function MusicXmlNoteMarks({
  page,
  keys,
  kind,
}: {
  page: LayoutPage;
  keys: readonly string[];
  kind: HighlightKind;
}) {
  const marked = new Set(keys);
  const chords = page.chords.filter((chord) => chord.notes.some((note) => marked.has(note.key)));
  return (
    <svg
      className="musicxml-page musicxml-note-marks"
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <style>{PAGE_STYLE}</style>
      {chords.map((chord) => (
        <g key={chord.id} className={`mx-${kind}`}>
          {chord.items.map((item, index) => draw(item, page.staffSpace, index))}
          {chord.notes.filter((note) => marked.has(note.key)).map((note) => (
            <g key={note.key}>{note.items.map((item, index) => draw(item, page.staffSpace, index))}</g>
          ))}
        </g>
      ))}
    </svg>
  );
});
