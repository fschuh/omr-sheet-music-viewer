// Credits, placed as MuseScore places those of a file it imports. The first page's credits in
// the top half of the page make a title frame above the first system: the title and subtitle
// centred at its top, the composer at its foot on the right. The rights go to the foot of the
// first page. Page numbers and the credits of later pages are left out. The file's positions
// only decide which column, and which half of the page, a credit belongs to.
import type { Drawable, PageFormat, TextRun } from "../model/layout";
import type { CreditModel, ScoreModel } from "../model/score";

const POINTS_TO_PIXELS = 300 / 72;
const LINE_HEIGHT = 1.2;
/** How far a line's baseline sits below its top, as a share of the text size. */
const ASCENT = 0.8;
/** MuseScore's title, subtitle, composer and lyricist sizes, in points. */
const ROLE_SIZE = { title: 22, subtitle: 14, composer: 10, lyricist: 10 } as const;
/** MuseScore's copyright size, in points. */
const COPYRIGHT_SIZE = 9;

type Role = keyof typeof ROLE_SIZE;
type Column = "left" | "center" | "right";

interface Entry {
  lines: TextRun[][];
  column: Column;
  /** Drawn at the frame's foot, below everything at its top. */
  foot: boolean;
}

function isRole(type: string | null): type is Role {
  return type !== null && type in ROLE_SIZE;
}

function isRights(credit: CreditModel): boolean {
  const text = credit.runs.map((run) => run.text).join("");
  return credit.types.includes("rights") ||
    (credit.types.length === 0 && (text.includes("©") || /all rights reserved/i.test(text)));
}

/** Lines of styled runs, split where the text breaks; a run without a size takes `points`. */
function creditLines(credit: CreditModel, points: number): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of credit.runs) {
    run.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) {
        lines[lines.length - 1].push({
          text: part,
          size: (run.fontSize ?? points) * POINTS_TO_PIXELS,
          italic: run.italic || undefined,
          bold: run.bold || undefined,
        });
      }
    });
  }
  return lines.filter((line) => line.length > 0);
}

function lineSize(runs: TextRun[]): number {
  return Math.max(...runs.map((run) => run.size ?? 0));
}

function columnOf(x: number, width: number): Column {
  return x > width / 3 ? (x < (2 * width) / 3 ? "center" : "right") : "left";
}

/**
 * A header credit's role: its credit type when it has exactly one that MuseScore styles,
 * otherwise a guess from its column, the largest centred credit being the title.
 */
function roleOf(credit: CreditModel, header: CreditModel[], width: number, pixelsPerTenth: number): Role {
  const type = credit.types.length === 1 ? credit.types[0] : null;
  if (isRole(type)) return type;
  const column = columnOf(credit.x * pixelsPerTenth, width);
  if (column === "right") return "composer";
  if (column === "left") return "lyricist";
  const size = (value: CreditModel) => value.runs[0]?.fontSize ?? 0;
  const larger = header.some((other) => other !== credit &&
    columnOf(other.x * pixelsPerTenth, width) === "center" && size(other) > size(credit));
  return larger ? "subtitle" : "title";
}

function columnX(column: Column, format: PageFormat): number {
  const left = format.margins.left;
  const right = format.width - format.margins.right;
  return column === "left" ? left : column === "right" ? right : (left + right) / 2;
}

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;

/** Draws `lines` in `column` from `top` down; returns where they end. */
function stackLines(items: Drawable[], lines: TextRun[][], column: Column, top: number, format: PageFormat): number {
  let y = top;
  for (const runs of lines) {
    const size = lineSize(runs);
    items.push({
      kind: "text",
      text: runs.map((run) => run.text).join(""),
      runs,
      x: columnX(column, format),
      y: y + size * ASCENT,
      size,
      anchor: ANCHOR[column],
    });
    y += size * LINE_HEIGHT;
  }
  return y;
}

function headerEntries(score: ScoreModel, format: PageFormat): Entry[] {
  const pixelsPerTenth = format.staffSpace / 10;
  const header = score.credits
    .filter((credit) => credit.page === 1 && credit.y * pixelsPerTenth > format.height / 2)
    .filter((credit) => !isRights(credit) && !credit.types.includes("page number"))
    // Top of the page first.
    .sort((a, b) => b.y - a.y);
  if (score.credits.length > 0) {
    return header.map((credit) => {
      const role = roleOf(credit, header, format.width, pixelsPerTenth);
      return {
        lines: creditLines(credit, ROLE_SIZE[role]),
        column: columnOf(credit.x * pixelsPerTenth, format.width),
        foot: role === "composer",
      };
    });
  }
  // A file without credits gets the titles it names elsewhere.
  const { title, subtitle, composer } = score.titles;
  const line = (text: string, role: Role): TextRun[][] => [[{ text, size: ROLE_SIZE[role] * POINTS_TO_PIXELS }]];
  return [
    ...(title ? [{ lines: line(title, "title"), column: "center" as const, foot: false }] : []),
    ...(subtitle ? [{ lines: line(subtitle, "subtitle"), column: "center" as const, foot: false }] : []),
    ...(composer ? [{ lines: line(composer, "composer"), column: "right" as const, foot: true }] : []),
  ];
}

/**
 * The title frame at the top of the first page: each column stacks its credits from the top
 * margin down, and the composer comes below everything else. Returns the frame's items and
 * its height, in page pixels.
 */
export function titleBlock(score: ScoreModel, format: PageFormat): { items: Drawable[]; height: number } {
  const entries = headerEntries(score, format);
  if (entries.length === 0) return { items: [], height: 0 };
  const items: Drawable[] = [];
  const top = format.margins.top;
  const ends = new Map<Column, number>();
  for (const entry of entries.filter((value) => !value.foot)) {
    ends.set(entry.column, stackLines(items, entry.lines, entry.column, ends.get(entry.column) ?? top, format));
  }
  const footTop = Math.max(top, ...ends.values());
  const footEnds = new Map<Column, number>();
  for (const entry of entries.filter((value) => value.foot)) {
    footEnds.set(entry.column, stackLines(items, entry.lines, entry.column, footEnds.get(entry.column) ?? footTop, format));
  }
  return { items, height: Math.max(footTop, ...footEnds.values()) - top };
}

/**
 * The first page's other credits: the rights centred in the bottom margin, and credits in the
 * bottom half of the page at the file's positions.
 */
export function pageCredits(score: ScoreModel, pageIndex: number, format: PageFormat): Drawable[] {
  if (pageIndex !== 0) return [];
  const pixelsPerTenth = format.staffSpace / 10;
  const items: Drawable[] = [];
  const firstPage = score.credits.filter((credit) => credit.page === 1);

  const rights = firstPage.filter(isRights).flatMap((credit) => creditLines(credit, COPYRIGHT_SIZE));
  const rightsHeight = rights.reduce((sum, runs) => sum + lineSize(runs) * LINE_HEIGHT, 0);
  stackLines(items, rights, "center", format.height - (format.margins.bottom + rightsHeight) / 2, format);

  const footer = firstPage.filter((credit) => credit.y * pixelsPerTenth <= format.height / 2 &&
    !isRights(credit) && !credit.types.includes("page number"));
  for (const credit of footer) {
    const lines = creditLines(credit, ROLE_SIZE.composer);
    const size = Math.max(...lines.map(lineSize));
    const height = size * LINE_HEIGHT;
    const anchorY = format.height - credit.y * pixelsPerTenth;
    // Where the first baseline goes, from the credit's vertical alignment.
    const firstBaseline =
      credit.valign === "top" ? anchorY + size * ASCENT
      : credit.valign === "middle" ? anchorY + size * 0.35 - (height * (lines.length - 1)) / 2
      : credit.valign === "bottom" ? anchorY - height * (lines.length - 1) - size * 0.2
      : anchorY - height * (lines.length - 1);
    lines.forEach((runs, index) => {
      items.push({
        kind: "text",
        text: runs.map((run) => run.text).join(""),
        runs,
        x: credit.x * pixelsPerTenth,
        y: firstBaseline + index * height,
        size: lineSize(runs),
        anchor: credit.align === "center" ? "middle" : credit.align === "right" ? "end" : "start",
      });
    });
  }
  return items;
}
