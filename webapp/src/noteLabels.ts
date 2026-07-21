import type {
  VisualBBox,
  VisualGroup,
  VisualGroupRef,
  VisualPoint,
  VisualSidecar,
  VisualSidecarNote,
} from "./types";

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
  anchor: VisualPoint;
}

export interface NoteLabelLayout extends Bounds {
  key: string;
  musicXmlId: string;
  visualGroupId: string;
  text: string;
  fontSize: number;
  anchor: VisualPoint;
  connector: VisualPoint;
}

export function selectedGroupIds(
  sidecar: VisualSidecar,
  selected: VisualGroupRef | null,
  pageIndex: number,
  highlightAll: boolean,
): Set<string> {
  if (highlightAll) return new Set(sidecar.visual_groups.map((group) => group.visual_group_id));
  if (!selected || selected.pageIndex !== pageIndex) return new Set();
  const group = sidecar.visual_groups.find(
    (candidate) => candidate.visual_group_id === selected.visualGroupId,
  );
  if (!group) return new Set();

  const result = new Set([group.visual_group_id]);
  const stemComponents = new Set(group.stem_component_ids ?? []);
  const notesByGroup = linkedNotes(sidecar);
  for (const candidate of sidecar.visual_groups) {
    if (
      candidate.staff_index !== group.staff_index ||
      candidate.stave_index !== group.stave_index
    ) {
      continue;
    }
    if (
      (candidate.stem_component_ids ?? []).some((component) => stemComponents.has(component)) ||
      stemlessWholeNotesFormChord(group, candidate, notesByGroup)
    ) {
      result.add(candidate.visual_group_id);
    }
  }
  return result;
}

function stemlessWholeNotesFormChord(
  first: VisualGroup,
  second: VisualGroup,
  notesByGroup: ReadonlyMap<string, VisualSidecarNote[]>,
): boolean {
  if (
    first.visual_group_id === second.visual_group_id ||
    !first.is_hollow_notehead ||
    !second.is_hollow_notehead ||
    (first.stem_component_ids?.length ?? 0) > 0 ||
    (second.stem_component_ids?.length ?? 0) > 0 ||
    !visuallyAlignedNoteheads(first, second)
  ) {
    return false;
  }

  const firstNotes = notesByGroup.get(first.visual_group_id) ?? [];
  const secondNotes = notesByGroup.get(second.visual_group_id) ?? [];
  return firstNotes.some((firstNote) =>
    secondNotes.some(
      (secondNote) =>
        firstNote.pitch !== null &&
        secondNote.pitch !== null &&
        firstNote.duration === "note_1" &&
        secondNote.duration === "note_1" &&
        firstNote.measure === secondNote.measure &&
        firstNote.staff === secondNote.staff &&
        firstNote.voice === secondNote.voice,
    ),
  );
}

function visuallyAlignedNoteheads(first: VisualGroup, second: VisualGroup): boolean {
  const firstNoteheads = first.notehead_ellipses ?? [];
  const secondNoteheads = second.notehead_ellipses ?? [];
  if (firstNoteheads.length === 0 || secondNoteheads.length === 0) return false;

  return firstNoteheads.some((firstNotehead) =>
    secondNoteheads.some((secondNotehead) => {
      const horizontalTolerance = clamp(
        Math.min(firstNotehead.rx, secondNotehead.rx) * 0.35,
        2,
        6,
      );
      return (
        Math.abs(firstNotehead.center[0] - secondNotehead.center[0]) <= horizontalTolerance &&
        Math.abs(firstNotehead.center[1] - secondNotehead.center[1]) >
          Math.min(firstNotehead.ry, secondNotehead.ry) * 0.5
      );
    }),
  );
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

function boundsFromPoints(points: VisualPoint[]): Bounds | null {
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
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function unionBounds(bounds: Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function noteheadBounds(group: VisualGroup): Bounds {
  const ellipseBounds = (group.notehead_ellipses ?? []).map((ellipse) => {
    const angle = (ellipse.angle * Math.PI) / 180;
    const halfWidth = Math.sqrt(
      (ellipse.rx * Math.cos(angle)) ** 2 + (ellipse.ry * Math.sin(angle)) ** 2,
    );
    const halfHeight = Math.sqrt(
      (ellipse.rx * Math.sin(angle)) ** 2 + (ellipse.ry * Math.cos(angle)) ** 2,
    );
    return {
      x: ellipse.center[0] - halfWidth,
      y: ellipse.center[1] - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
    };
  });
  const contourBounds = group.notehead_contours
    .map(boundsFromPoints)
    .filter((value): value is Bounds => value !== null);
  const noteheads = unionBounds(ellipseBounds.length > 0 ? ellipseBounds : contourBounds);
  if (noteheads) return noteheads;
  if (group.bbox.length === 4) {
    const [left, top, right, bottom] = group.bbox as VisualBBox;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  return { x: group.center[0] - 5, y: group.center[1] - 5, width: 10, height: 10 };
}

function childText(element: Element, localName: string): string | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) return child.textContent?.trim() || null;
  }
  return null;
}

function firstChild(element: Element, localName: string): Element | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) return child;
  }
  return null;
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

export function musicXmlPitchNames(musicXml?: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!musicXml || typeof DOMParser === "undefined") return result;
  const document = new DOMParser().parseFromString(musicXml, "application/xml");
  if (document.querySelector("parsererror")) return result;
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.localName !== "note") continue;
    const id = element.getAttribute("id");
    const pitch = firstChild(element, "pitch");
    if (!id || !pitch) continue;
    const step = childText(pitch, "step");
    const octave = childText(pitch, "octave");
    const parsedAlter = Number(childText(pitch, "alter") ?? 0);
    if (!step || octave === null || !Number.isFinite(parsedAlter)) continue;
    result.set(id, formatPitchName(step, octave, parsedAlter));
  }
  return result;
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

function connectorPoint(anchor: VisualPoint, box: Bounds): VisualPoint {
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

  const slots: VisualPoint[] = [];
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

function linkedNotes(sidecar: VisualSidecar): Map<string, VisualSidecarNote[]> {
  const result = new Map<string, VisualSidecarNote[]>();
  for (const note of sidecar.notes) {
    if (!note.visual_group_id) continue;
    const notes = result.get(note.visual_group_id) ?? [];
    notes.push(note);
    result.set(note.visual_group_id, notes);
  }
  return result;
}

function labelRequests(
  sidecar: VisualSidecar,
  selectedIds: Set<string>,
  musicXml?: string,
): NoteLabelRequest[] {
  const pitchNames = musicXmlPitchNames(musicXml);
  const notesByGroup = linkedNotes(sidecar);
  const requests: NoteLabelRequest[] = [];
  const seenMusicXmlIds = new Set<string>();

  for (const group of sidecar.visual_groups) {
    if (!selectedIds.has(group.visual_group_id)) continue;
    const bounds = noteheadBounds(group);
    const anchor: VisualPoint = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
    const notes = notesByGroup.get(group.visual_group_id) ?? [];
    for (const note of notes) {
      if (!note.pitch || seenMusicXmlIds.has(note.musicxml_id)) continue;
      seenMusicXmlIds.add(note.musicxml_id);
      requests.push({
        musicXmlId: note.musicxml_id,
        visualGroupId: group.visual_group_id,
        text: pitchNames.get(note.musicxml_id) ?? formatStoredPitch(note.pitch),
        anchorBounds: bounds,
        anchor,
      });
    }
    for (const musicXmlId of group.musicxml_ids) {
      const text = pitchNames.get(musicXmlId);
      if (!text || seenMusicXmlIds.has(musicXmlId)) continue;
      seenMusicXmlIds.add(musicXmlId);
      requests.push({
        musicXmlId,
        visualGroupId: group.visual_group_id,
        text,
        anchorBounds: bounds,
        anchor,
      });
    }
  }

  return requests.sort(
    (first, second) =>
      first.anchor[1] - second.anchor[1] ||
      first.anchor[0] - second.anchor[0] ||
      first.musicXmlId.localeCompare(second.musicXmlId),
  );
}

export function layoutNoteLabels(
  sidecar: VisualSidecar,
  selectedIds: Set<string>,
  pageWidth: number,
  pageHeight: number,
  musicXml?: string,
): NoteLabelLayout[] {
  const requests = labelRequests(sidecar, selectedIds, musicXml);
  if (requests.length === 0) return [];
  const noteheadHeights = sidecar.visual_groups.map((group) => noteheadBounds(group).height);
  const fontSize = clamp(
    Math.max(pageWidth * 0.0185, median(noteheadHeights) * 2.1),
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
  );
  const obstacles = sidecar.visual_groups.map(noteheadBounds);
  const nearby = greedyLayout(requests, obstacles, fontSize, pageWidth, pageHeight);
  if (nearby) return nearby;

  // Extremely dense scores fall back to page-wide fixed cells. Each cell is
  // larger than the largest label, which keeps the no-overlap guarantee.
  for (let fallbackFontSize = fontSize; fallbackFontSize >= 28; fallbackFontSize -= 2) {
    const grid = gridLayout(requests, fallbackFontSize, pageWidth, pageHeight);
    if (grid) return grid;
  }
  return [];
}
