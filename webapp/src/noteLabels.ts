import type { GeometryNote, NoteheadGeometry, PageNoteGeometry, Point } from "./noteGeometry";

const MIN_FONT_SIZE = 34;
const MAX_FONT_SIZE = 50;
const LABEL_CLEARANCE_RATIO = 0.12;
const PAGE_MARGIN_RATIO = 0.1;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NoteLabelRequest {
  musicXmlId: string;
  visualGroupId: string;
  text: string;
  anchorBounds: Bounds;
  anchor: Point;
}

export interface NoteLabelLayout extends Bounds {
  key: string;
  musicXmlId: string;
  visualGroupId: string;
  text: string;
  fontSize: number;
  anchor: Point;
  connector: Point;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function noteheadBounds(notehead: NoteheadGeometry): Bounds {
  const [left, top, right, bottom] = notehead.noteheadBounds;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function accidentalSymbols(alter: number): string {
  if (alter === 0) return "";
  if (Number.isInteger(alter)) {
    return (alter > 0 ? "♯" : "♭").repeat(Math.abs(alter));
  }
  return alter > 0 ? `(+${alter})` : `(${alter})`;
}

export function formatPitchName(step: string, octave: string | number, alter = 0): string {
  return `${step.toUpperCase()}${accidentalSymbols(alter)}${octave}`;
}

function formatStoredPitch(pitch: string): string {
  const match = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(pitch.trim());
  if (!match) return pitch;
  const accidental = match[2].replaceAll("#", "♯").replaceAll("b", "♭");
  return `${match[1].toUpperCase()}${accidental}${match[3]}`;
}

function labelDimensions(text: string, fontSize: number): { width: number; height: number } {
  const textWidth = Array.from(text).reduce((total, character) => {
    if (character === "♯" || character === "♭") return total + fontSize * 0.68;
    if (/\d/.test(character)) return total + fontSize * 0.58;
    if (character === "-" || character === "+") return total + fontSize * 0.42;
    return total + fontSize * 0.72;
  }, 0);
  return {
    width: Math.ceil(textWidth + fontSize * 0.56),
    height: Math.ceil(fontSize * 1.28),
  };
}

function boxIntersects(first: Bounds, second: Bounds, clearance = 0): boolean {
  return (
    first.x < second.x + second.width + clearance &&
    first.x + first.width + clearance > second.x &&
    first.y < second.y + second.height + clearance &&
    first.y + first.height + clearance > second.y
  );
}

export function noteLabelsOverlap(first: Bounds, second: Bounds): boolean {
  return boxIntersects(first, second);
}

function isInsidePage(box: Bounds, pageWidth: number, pageHeight: number, margin: number): boolean {
  return (
    box.x >= margin &&
    box.y >= margin &&
    box.x + box.width <= pageWidth - margin &&
    box.y + box.height <= pageHeight - margin
  );
}

function candidateBoxes(request: NoteLabelRequest, width: number, height: number, gap: number): Bounds[] {
  const anchor = request.anchorBounds;
  const centerX = request.anchor[0];
  const centerY = request.anchor[1];
  const result: Bounds[] = [
    { x: anchor.x + anchor.width + gap, y: centerY - height / 2, width, height },
    { x: anchor.x - gap - width, y: centerY - height / 2, width, height },
    { x: centerX - width / 2, y: anchor.y - gap - height, width, height },
    { x: centerX - width / 2, y: anchor.y + anchor.height + gap, width, height },
    { x: anchor.x + anchor.width + gap, y: anchor.y - gap - height, width, height },
    { x: anchor.x + anchor.width + gap, y: anchor.y + anchor.height + gap, width, height },
    { x: anchor.x - gap - width, y: anchor.y - gap - height, width, height },
    { x: anchor.x - gap - width, y: anchor.y + anchor.height + gap, width, height },
  ];
  const angles = [
    0,
    -Math.PI / 4,
    Math.PI / 4,
    Math.PI,
    -Math.PI / 2,
    Math.PI / 2,
    -Math.PI / 8,
    Math.PI / 8,
    (-3 * Math.PI) / 4,
    (3 * Math.PI) / 4,
    (-3 * Math.PI) / 8,
    (3 * Math.PI) / 8,
    (-5 * Math.PI) / 8,
    (5 * Math.PI) / 8,
    (-7 * Math.PI) / 8,
    (7 * Math.PI) / 8,
  ];
  for (let ring = 1; ring <= 5; ring += 1) {
    const radiusX = anchor.width / 2 + gap + width / 2 + ring * width * 0.42;
    const radiusY = anchor.height / 2 + gap + height / 2 + ring * height * 0.42;
    for (const angle of angles) {
      result.push({
        x: centerX + Math.cos(angle) * radiusX - width / 2,
        y: centerY + Math.sin(angle) * radiusY - height / 2,
        width,
        height,
      });
    }
  }
  return result;
}

function connectorPoint(anchor: Point, box: Bounds): Point {
  return [
    clamp(anchor[0], box.x, box.x + box.width),
    clamp(anchor[1], box.y, box.y + box.height),
  ];
}

function toLayout(
  request: NoteLabelRequest,
  box: Bounds,
  fontSize: number,
  duplicateIndex: number,
): NoteLabelLayout {
  return {
    ...box,
    key: `${request.musicXmlId}-${duplicateIndex}`,
    musicXmlId: request.musicXmlId,
    visualGroupId: request.visualGroupId,
    text: request.text,
    fontSize,
    anchor: request.anchor,
    connector: connectorPoint(request.anchor, box),
  };
}

function greedyLayout(
  requests: NoteLabelRequest[],
  obstacles: Bounds[],
  fontSize: number,
  pageWidth: number,
  pageHeight: number,
): NoteLabelLayout[] | null {
  const clearance = Math.max(4, fontSize * LABEL_CLEARANCE_RATIO);
  const margin = Math.max(3, fontSize * PAGE_MARGIN_RATIO);
  const occupied: Bounds[] = [];
  const labels: NoteLabelLayout[] = [];
  const idCounts = new Map<string, number>();

  for (const request of requests) {
    const dimensions = labelDimensions(request.text, fontSize);
    const candidates = candidateBoxes(request, dimensions.width, dimensions.height, clearance);
    const fits = (box: Bounds, avoidNotes: boolean) =>
      isInsidePage(box, pageWidth, pageHeight, margin) &&
      !occupied.some((other) => boxIntersects(box, other, clearance)) &&
      (!avoidNotes || !obstacles.some((obstacle) => boxIntersects(box, obstacle, 2)));
    const box = candidates.find((candidate) => fits(candidate, true)) ??
      candidates.find((candidate) => fits(candidate, false));
    if (!box) return null;
    const duplicateIndex = idCounts.get(request.musicXmlId) ?? 0;
    idCounts.set(request.musicXmlId, duplicateIndex + 1);
    occupied.push(box);
    labels.push(toLayout(request, box, fontSize, duplicateIndex));
  }
  return labels;
}

function gridLayout(
  requests: NoteLabelRequest[],
  fontSize: number,
  pageWidth: number,
  pageHeight: number,
): NoteLabelLayout[] | null {
  const clearance = Math.max(4, fontSize * LABEL_CLEARANCE_RATIO);
  const margin = Math.max(3, fontSize * PAGE_MARGIN_RATIO);
  const dimensions = requests.map((request) => labelDimensions(request.text, fontSize));
  const cellWidth = Math.max(...dimensions.map((value) => value.width)) + clearance;
  const cellHeight = Math.max(...dimensions.map((value) => value.height)) + clearance;
  const columns = Math.floor((pageWidth - margin * 2) / cellWidth);
  const rows = Math.floor((pageHeight - margin * 2) / cellHeight);
  if (columns * rows < requests.length) return null;

  const slots: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push([
        margin + column * cellWidth + cellWidth / 2,
        margin + row * cellHeight + cellHeight / 2,
      ]);
    }
  }
  const labels: NoteLabelLayout[] = [];
  const idCounts = new Map<string, number>();
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    let bestSlotIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex];
      const distance = Math.hypot(slot[0] - request.anchor[0], slot[1] - request.anchor[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlotIndex = slotIndex;
      }
    }
    const [slotX, slotY] = slots.splice(bestSlotIndex, 1)[0];
    const box = {
      x: slotX - dimensions[index].width / 2,
      y: slotY - dimensions[index].height / 2,
      width: dimensions[index].width,
      height: dimensions[index].height,
    };
    const duplicateIndex = idCounts.get(request.musicXmlId) ?? 0;
    idCounts.set(request.musicXmlId, duplicateIndex + 1);
    labels.push(toLayout(request, box, fontSize, duplicateIndex));
  }
  return labels;
}

interface PageLayoutData {
  noteheads: Map<string, NoteheadGeometry>;
  notes: Map<string, GeometryNote>;
  bounds: Map<string, Bounds>;
  noteheadHeights: number[];
  obstacles: Bounds[];
}

const pageLayoutCache = new WeakMap<PageNoteGeometry, PageLayoutData>();

function pageLayoutData(geometry: PageNoteGeometry): PageLayoutData {
  const cached = pageLayoutCache.get(geometry);
  if (cached) return cached;
  const noteheads = new Map(geometry.noteheads.map((notehead) => [notehead.id, notehead]));
  // A notehead shared by several notes is labelled with the last of them.
  const notes = new Map<string, GeometryNote>();
  for (const note of geometry.notes) notes.set(note.noteheadId, note);
  const bounds = new Map<string, Bounds>();
  const noteheadHeights: number[] = [];
  const obstacles: Bounds[] = [];
  for (const notehead of geometry.noteheads) {
    const value = noteheadBounds(notehead);
    bounds.set(notehead.id, value);
    noteheadHeights.push(value.height);
    obstacles.push(value);
  }
  const result = { noteheads, notes, bounds, noteheadHeights, obstacles };
  pageLayoutCache.set(geometry, result);
  return result;
}

function labelRequests(geometry: PageNoteGeometry, selectedIds: Set<string>): NoteLabelRequest[] {
  const layoutData = pageLayoutData(geometry);
  const requests: NoteLabelRequest[] = [];
  const seenNoteIds = new Set<string>();

  for (const noteheadId of selectedIds) {
    const notehead = layoutData.noteheads.get(noteheadId);
    if (!notehead) continue;
    const bounds = layoutData.bounds.get(noteheadId) ?? noteheadBounds(notehead);
    const anchor: Point = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
    const note = layoutData.notes.get(notehead.id);
    if (!note?.pitch || seenNoteIds.has(note.id)) continue;
    seenNoteIds.add(note.id);
    requests.push({
      musicXmlId: note.id,
      visualGroupId: notehead.id,
      text: formatStoredPitch(note.pitch),
      anchorBounds: bounds,
      anchor,
    });
  }

  return requests.sort(
    (first, second) =>
      first.anchor[1] - second.anchor[1] ||
      first.anchor[0] - second.anchor[0] ||
      first.musicXmlId.localeCompare(second.musicXmlId),
  );
}

export function layoutNoteLabels(
  geometry: PageNoteGeometry,
  selectedIds: Set<string>,
  pageWidth: number,
  pageHeight: number,
): NoteLabelLayout[] {
  const requests = labelRequests(geometry, selectedIds);
  if (requests.length === 0) return [];
  const layoutData = pageLayoutData(geometry);
  const fontSize = clamp(
    Math.max(pageWidth * 0.0185, median(layoutData.noteheadHeights) * 2.1),
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
  );
  const nearby = greedyLayout(requests, layoutData.obstacles, fontSize, pageWidth, pageHeight);
  if (nearby) return nearby;

  // Extremely dense scores fall back to page-wide fixed cells. Each cell is
  // larger than the largest label, which keeps the no-overlap guarantee.
  for (let fallbackFontSize = fontSize; fallbackFontSize >= 28; fallbackFontSize -= 2) {
    const grid = gridLayout(requests, fallbackFontSize, pageWidth, pageHeight);
    if (grid) return grid;
  }
  return [];
}
