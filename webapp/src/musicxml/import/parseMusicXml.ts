// MusicXML text to the score model. This is the only part of the module that reads XML.
import { DOMParser } from "@xmldom/xmldom";
import {
  add,
  compare,
  fraction,
  maxFraction,
  subtract,
  ZERO,
  type Fraction,
} from "../model/fraction";
import type {
  BarlineModel,
  BeamValue,
  ChordModel,
  ClefChange,
  ClefSign,
  CreditModel,
  CreditRun,
  KeyChange,
  MeasureModel,
  NoteModel,
  NoteType,
  PartMeasureModel,
  PartModel,
  ScoreDefaults,
  ScoreModel,
  SystemLayout,
  TimeChange,
  TupletStart,
} from "../model/score";
import { chordKey, NoteKeyAllocator, pitchToken } from "./noteKeys";

export class MusicXmlImportError extends Error {
  override name = "MusicXmlImportError";
}

/** An attribute's value, or null when it is missing or empty (xmldom returns "" for missing ones). */
function attribute(element: Element | undefined, name: string): string | null {
  return element?.getAttribute(name) || null;
}

function childElements(parent: Element, name?: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element =>
      node.nodeType === 1 && (name === undefined || (node as Element).localName === name),
  );
}

function childElement(parent: Element | undefined, name: string): Element | undefined {
  return parent ? childElements(parent, name)[0] : undefined;
}

function childText(parent: Element | undefined, name: string): string | undefined {
  return childElement(parent, name)?.textContent?.trim() || undefined;
}

function childNumber(parent: Element | undefined, name: string): number | null {
  const text = childText(parent, name);
  if (text === undefined) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function positiveNumber(parent: Element | undefined, name: string): number | null {
  const value = childNumber(parent, name);
  return value !== null && value > 0 ? value : null;
}

function parseSystemLayout(element: Element | undefined): SystemLayout {
  const margins = childElement(element, "system-margins");
  return {
    leftMargin: childNumber(margins, "left-margin"),
    rightMargin: childNumber(margins, "right-margin"),
    systemDistance: childNumber(element, "system-distance"),
    topSystemDistance: childNumber(element, "top-system-distance"),
  };
}

function parseDefaults(root: Element): ScoreDefaults {
  const defaults = childElement(root, "defaults");
  const scaling = childElement(defaults, "scaling");
  const millimeters = positiveNumber(scaling, "millimeters");
  const tenths = positiveNumber(scaling, "tenths");
  const pageLayout = childElement(defaults, "page-layout");
  const width = positiveNumber(pageLayout, "page-width");
  const height = positiveNumber(pageLayout, "page-height");
  // Odd-page margins, or margins for both sides.
  const marginsElement = pageLayout
    ? childElements(pageLayout, "page-margins").find(
        (element) => attribute(element, "type") !== "even",
      )
    : undefined;
  const margins = marginsElement
    ? {
        left: childNumber(marginsElement, "left-margin"),
        right: childNumber(marginsElement, "right-margin"),
        top: childNumber(marginsElement, "top-margin"),
        bottom: childNumber(marginsElement, "bottom-margin"),
      }
    : null;
  return {
    scaling: millimeters !== null && tenths !== null ? { millimeters, tenths } : null,
    pageSize: width !== null && height !== null ? { width, height } : null,
    pageMargins:
      margins && margins.left !== null && margins.right !== null && margins.top !== null && margins.bottom !== null
        ? { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom }
        : null,
    systemLayout: parseSystemLayout(childElement(defaults, "system-layout")),
    staffDistance: childNumber(childElement(defaults, "staff-layout"), "staff-distance"),
  };
}

const NOTE_TYPES = new Set<string>([
  "maxima", "long", "breve", "whole", "half", "quarter", "eighth",
  "16th", "32nd", "64th", "128th", "256th", "512th", "1024th",
]);
const BEAM_VALUES = new Set<string>(["begin", "continue", "end", "forward hook", "backward hook"]);
const CLEF_SIGNS = new Set<string>(["G", "F", "C", "percussion", "TAB", "none"]);

/** One part's measures as elements: a partwise part, or its pieces of a timewise score. */
export interface PartSource {
  id: string;
  measures: { number: string; content: Element }[];
}

function partSources(root: Element): PartSource[] {
  if (root.localName === "score-partwise") {
    return childElements(root, "part").map((part, index) => ({
      id: attribute(part, "id") ?? `P${index + 1}`,
      measures: childElements(part, "measure").map((measure, position) => ({
        number: attribute(measure, "number") ?? String(position + 1),
        content: measure,
      })),
    }));
  }
  const parts = new Map<string, PartSource>();
  for (const [position, measure] of childElements(root, "measure").entries()) {
    for (const part of childElements(measure, "part")) {
      const id = attribute(part, "id") ?? "P1";
      const source = parts.get(id) ?? { id, measures: [] };
      source.measures[position] = {
        number: attribute(measure, "number") ?? String(position + 1),
        content: part,
      };
      parts.set(id, source);
    }
  }
  return [...parts.values()];
}

function partNames(root: Element): Map<string, string> {
  const names = new Map<string, string>();
  for (const part of childElements(childElement(root, "part-list") ?? root, "score-part")) {
    names.set(attribute(part, "id") ?? "", childText(part, "part-name") ?? "");
  }
  return names;
}

interface MeasureState {
  divisions: number;
  staffCount: number;
}

interface ParsedPartMeasure {
  measure: PartMeasureModel;
  duration: Fraction;
  newPage: boolean;
  newSystem: boolean;
  systemLayout: SystemLayout | null;
  staffDistance: number | null;
}

function parseBeams(note: Element): (BeamValue | null)[] {
  const beams: (BeamValue | null)[] = [];
  for (const beam of childElements(note, "beam")) {
    const level = Number(attribute(beam, "number") ?? "1");
    const value = beam.textContent?.trim() ?? "";
    if (Number.isInteger(level) && level >= 1 && level <= 8 && BEAM_VALUES.has(value)) {
      while (beams.length < level) beams.push(null);
      beams[level - 1] = value as BeamValue;
    }
  }
  return beams;
}

function parseTuplets(note: Element): { tupletStarts: TupletStart[]; tupletStops: string[] } {
  const tupletStarts: TupletStart[] = [];
  const tupletStops: string[] = [];
  const modification = childElement(note, "time-modification");
  for (const notations of childElements(note, "notations")) {
    for (const tuplet of childElements(notations, "tuplet")) {
      const number = attribute(tuplet, "number") ?? "1";
      if (attribute(tuplet, "type") === "stop") {
        tupletStops.push(number);
        continue;
      }
      const bracket = attribute(tuplet, "bracket");
      const show = attribute(tuplet, "show-number");
      const placement = attribute(tuplet, "placement");
      const actual = childNumber(childElement(tuplet, "tuplet-actual"), "tuplet-number") ?? childNumber(modification, "actual-notes") ?? 3;
      const normal = childNumber(childElement(tuplet, "tuplet-normal"), "tuplet-number") ?? childNumber(modification, "normal-notes") ?? 2;
      tupletStarts.push({
        number,
        bracket: bracket === "yes" ? true : bracket === "no" ? false : null,
        showNumber: show === "both" || show === "none" ? show : "actual",
        placement: placement === "above" || placement === "below" ? placement : null,
        actual,
        normal,
      });
    }
  }
  return { tupletStarts, tupletStops };
}

function parseNotePitch(note: Element): Pick<NoteModel, "step" | "alter" | "octave" | "unpitched"> | null {
  const pitch = childElement(note, "pitch");
  if (pitch) {
    return {
      step: childText(pitch, "step") ?? "C",
      alter: childNumber(pitch, "alter") ?? 0,
      octave: childNumber(pitch, "octave") ?? 4,
      unpitched: false,
    };
  }
  const unpitched = childElement(note, "unpitched");
  if (unpitched) {
    return {
      step: childText(unpitched, "display-step") ?? "B",
      alter: 0,
      octave: childNumber(unpitched, "display-octave") ?? 4,
      unpitched: true,
    };
  }
  return null;
}

/**
 * One part's measure: attributes, chords with exact onsets, barlines and print hints.
 * Chords get their keys later, once the whole part is read.
 */
function parsePartMeasure(
  content: Element,
  state: MeasureState,
  noteElements: Map<NoteModel, Element>,
): ParsedPartMeasure {
  const measure: PartMeasureModel = { clefs: [], keys: [], times: [], chords: [], barlines: [] };
  let position = ZERO;
  let furthest = ZERO;
  let newPage = false;
  let newSystem = false;
  let systemLayout: SystemLayout | null = null;
  let staffDistance: number | null = null;
  let previousChord: ChordModel | null = null;
  const duration = (element: Element) =>
    fraction(Math.max(0, Math.round(childNumber(element, "duration") ?? 0)), state.divisions * 4);

  for (const element of childElements(content)) {
    switch (element.localName) {
      case "attributes": {
        const divisions = positiveNumber(element, "divisions");
        if (divisions !== null) state.divisions = divisions;
        const staves = positiveNumber(element, "staves");
        if (staves !== null) state.staffCount = Math.round(staves);
        for (const key of childElements(element, "key")) {
          const fifths = childNumber(key, "fifths");
          if (fifths === null) continue;
          const staff = attribute(key, "number");
          measure.keys.push({ onset: position, staff: staff ? Number(staff) : null, fifths } satisfies KeyChange);
        }
        for (const time of childElements(element, "time")) {
          const symbol = attribute(time, "symbol") ?? "normal";
          measure.times.push({
            onset: position,
            beats: childText(time, "beats") ?? "4",
            beatType: childText(time, "beat-type") ?? "4",
            symbol: (["normal", "common", "cut", "single-number", "none"].includes(symbol)
              ? symbol
              : "normal") as TimeChange["symbol"],
          });
        }
        for (const clef of childElements(element, "clef")) {
          const sign = childText(clef, "sign") ?? "G";
          measure.clefs.push({
            onset: position,
            staff: Number(attribute(clef, "number") ?? "1"),
            sign: (CLEF_SIGNS.has(sign) ? sign : "G") as ClefSign,
            line: childNumber(clef, "line") ?? (sign === "F" ? 4 : sign === "C" ? 3 : 2),
            octaveChange: childNumber(clef, "clef-octave-change") ?? 0,
          } satisfies ClefChange);
        }
        break;
      }
      case "backup":
        position = subtract(position, duration(element));
        if (compare(position, ZERO) < 0) position = ZERO;
        previousChord = null;
        break;
      case "forward":
        position = add(position, duration(element));
        furthest = maxFraction(furthest, position);
        previousChord = null;
        break;
      case "print": {
        if (attribute(element, "new-page") === "yes") newPage = true;
        if (attribute(element, "new-system") === "yes") newSystem = true;
        const layout = childElement(element, "system-layout");
        if (layout) systemLayout = parseSystemLayout(layout);
        const staffLayout = childElement(element, "staff-layout");
        if (staffLayout) staffDistance = childNumber(staffLayout, "staff-distance");
        break;
      }
      case "barline": {
        const location = attribute(element, "location") ?? "right";
        const repeat = attribute(childElement(element, "repeat"), "direction");
        const ending = childElement(element, "ending");
        const endingType = attribute(ending, "type");
        const endingNumber = attribute(ending, "number") ?? "1";
        measure.barlines.push({
          location: (location === "left" || location === "middle" ? location : "right") as BarlineModel["location"],
          style: childText(element, "bar-style") ?? (repeat === "forward" ? "heavy-light" : repeat === "backward" ? "light-heavy" : "regular"),
          repeat: repeat === "forward" || repeat === "backward" ? repeat : null,
          ending: ending && (endingType === "start" || endingType === "stop" || endingType === "discontinue")
            ? { number: endingNumber, type: endingType, text: ending.textContent?.trim() || `${endingNumber.split(",")[0].trim()}.` }
            : null,
        });
        break;
      }
      case "note": {
        const graceElement = childElement(element, "grace");
        const isChordContinuation = childElement(element, "chord") !== undefined && previousChord !== null;
        const pitch = parseNotePitch(element);
        const tieTypes = childElements(element, "tie").map((tie) => attribute(tie, "type"));
        const note: NoteModel | null = pitch
          ? {
              key: "",
              ...pitch,
              accidental: childText(element, "accidental") ?? null,
              accidentalParentheses: attribute(childElement(element, "accidental"), "parentheses") === "yes",
              tieStart: tieTypes.includes("start"),
              tieStop: tieTypes.includes("stop"),
            }
          : null;
        if (note) noteElements.set(note, element);
        if (isChordContinuation && previousChord) {
          if (note) previousChord.notes.push(note);
          const tuplets = parseTuplets(element);
          previousChord.tupletStarts.push(...tuplets.tupletStarts);
          previousChord.tupletStops.push(...tuplets.tupletStops);
          break;
        }
        const type = childText(element, "type");
        const rest = childElement(element, "rest");
        const stem = childText(element, "stem");
        const chord: ChordModel = {
          id: "",
          staff: Math.max(1, Math.round(childNumber(element, "staff") ?? 1)),
          voice: childText(element, "voice") ?? "1",
          onset: position,
          duration: graceElement ? ZERO : duration(element),
          type: type && NOTE_TYPES.has(type) ? (type as NoteType) : null,
          dots: childElements(element, "dot").length,
          rest: rest !== undefined,
          measureRest: attribute(rest, "measure") === "yes",
          restPosition:
            rest && childText(rest, "display-step")
              ? { step: childText(rest, "display-step")!, octave: childNumber(rest, "display-octave") ?? 4 }
              : null,
          grace: graceElement ? { slash: attribute(graceElement, "slash") === "yes" } : null,
          cue: childElement(element, "cue") !== undefined,
          printed: attribute(element, "print-object") !== "no",
          stem: stem === "up" || stem === "down" || stem === "none" || stem === "double" ? stem : null,
          beams: parseBeams(element),
          ...parseTuplets(element),
          notes: note && !rest ? [note] : [],
        };
        measure.chords.push(chord);
        previousChord = chord;
        position = add(position, chord.duration);
        furthest = maxFraction(furthest, position);
        break;
      }
      default:
        break;
    }
  }
  return { measure, duration: furthest, newPage, newSystem, systemLayout, staffDistance };
}

/** Gives every chord of a part its key and every note its structural key. */
function assignKeys(partId: string, measures: PartMeasureModel[]): void {
  const notes = new NoteKeyAllocator();
  const chords = new NoteKeyAllocator();
  measures.forEach((measure, measureIndex) => {
    // Grace chords count up toward the onset they precede, per staff and voice.
    const graceCounts = new Map<string, number>();
    for (const chord of measure.chords) {
      let graceOrdinal: number | null = null;
      const slot = `${chord.staff}|${chord.voice}|${chord.onset.n}/${chord.onset.d}`;
      if (chord.grace) {
        graceOrdinal = (graceCounts.get(slot) ?? 0) + 1;
        graceCounts.set(slot, graceOrdinal);
      }
      const base = chordKey({
        partId,
        measureIndex,
        staff: chord.staff,
        voice: chord.voice,
        onset: chord.onset,
        graceOrdinal,
      });
      chord.id = chords.allocate(base);
      for (const note of chord.notes) {
        note.key = notes.allocate(`${base}-${note.unpitched ? "u" : ""}${pitchToken(note.step, note.alter, note.octave)}`);
      }
    }
  });
}

const EMPTY_SYSTEM_LAYOUT: SystemLayout = {
  leftMargin: null,
  rightMargin: null,
  systemDistance: null,
  topSystemDistance: null,
};

function mergeSystemLayout(target: SystemLayout, source: SystemLayout | null): SystemLayout {
  if (!source) return target;
  return {
    leftMargin: source.leftMargin ?? target.leftMargin,
    rightMargin: source.rightMargin ?? target.rightMargin,
    systemDistance: source.systemDistance ?? target.systemDistance,
    topSystemDistance: source.topSystemDistance ?? target.topSystemDistance,
  };
}

/** MusicXML's default text size, in points. */
const DEFAULT_FONT_SIZE = 10;

function parseCredits(root: Element): CreditModel[] {
  return childElements(root, "credit").flatMap((credit): CreditModel[] => {
    const words = childElements(credit, "credit-words");
    if (words.length === 0) return [];
    const first = words[0];
    const x = Number(attribute(first, "default-x") ?? NaN);
    const y = Number(attribute(first, "default-y") ?? NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const align = attribute(first, "halign") ?? attribute(first, "justify") ?? "left";
    const valign = attribute(first, "valign") ?? "baseline";
    let previous: CreditRun | null = null;
    const runs = words.map((word): CreditRun => {
      const size = Number(attribute(word, "font-size") ?? NaN);
      const style = attribute(word, "font-style");
      const weight = attribute(word, "font-weight");
      const run: CreditRun = {
        text: word.textContent ?? "",
        fontSize: Number.isFinite(size) && size > 0 ? size : previous?.fontSize ?? DEFAULT_FONT_SIZE,
        italic: style ? style === "italic" : previous?.italic ?? false,
        bold: weight ? weight === "bold" : previous?.bold ?? false,
      };
      previous = run;
      return run;
    });
    return [{
      page: Number(attribute(credit, "page") ?? 1) || 1,
      x,
      y,
      align: align === "center" || align === "right" ? align : "left",
      valign: valign === "top" || valign === "middle" || valign === "bottom" ? valign : "baseline",
      runs,
    }];
  });
}

function parseTitles(root: Element): ScoreModel["titles"] {
  const work = childElement(root, "work");
  const composer = childElements(childElement(root, "identification") ?? root, "creator")
    .find((creator) => attribute(creator, "type") === "composer");
  const workTitle = childText(work, "work-title") ?? null;
  const movementTitle = childText(root, "movement-title") ?? null;
  return {
    title: (workTitle ?? movementTitle)?.replace(/^"(.*)"$/, "$1") ?? null,
    subtitle: workTitle && movementTitle && movementTitle !== workTitle ? movementTitle : null,
    composer: composer?.textContent?.trim() || null,
  };
}

function parseScore(root: Element, sources: PartSource[], noteElements: Map<NoteModel, Element>): ScoreModel {
  const names = partNames(root);
  const measures: MeasureModel[] = [];
  const parts: PartModel[] = sources.map((source) => {
    const state: MeasureState = { divisions: 1, staffCount: 1 };
    const partMeasures: PartMeasureModel[] = [];
    source.measures.forEach((entry, position) => {
      const parsed = entry
        ? parsePartMeasure(entry.content, state, noteElements)
        : { measure: { clefs: [], keys: [], times: [], chords: [], barlines: [] }, duration: ZERO, newPage: false, newSystem: false, systemLayout: null, staffDistance: null };
      partMeasures.push(parsed.measure);
      const shared = (measures[position] ??= {
        number: entry?.number ?? String(position + 1),
        newPage: false,
        newSystem: false,
        systemLayout: EMPTY_SYSTEM_LAYOUT,
        staffDistance: null,
        duration: ZERO,
      });
      shared.newPage ||= parsed.newPage;
      shared.newSystem ||= parsed.newSystem || parsed.newPage;
      shared.systemLayout = mergeSystemLayout(shared.systemLayout, parsed.systemLayout);
      shared.staffDistance ??= parsed.staffDistance;
      shared.duration = maxFraction(shared.duration, parsed.duration);
    });
    assignKeys(source.id, partMeasures);
    return {
      id: source.id,
      name: names.get(source.id) ?? "",
      staffCount: state.staffCount,
      measures: partMeasures,
    };
  });
  // Every part has every measure, so layout can index them by position.
  for (const part of parts) {
    while (part.measures.length < measures.length) {
      part.measures.push({ clefs: [], keys: [], times: [], chords: [], barlines: [] });
    }
  }
  return { defaults: parseDefaults(root), credits: parseCredits(root), titles: parseTitles(root), parts, measures };
}

/** A score as imported, with the parsed XML that `documentMusicXml` writes viewer IDs into. */
export interface ImportedScore {
  score: ScoreModel;
  root: Element;
  parts: PartSource[];
  /** Each note's `<note>` element, by note key. */
  noteElements: Map<string, Element>;
}

export function parseMusicXml(text: string): ScoreModel {
  return importMusicXml(text).score;
}

export function importMusicXml(text: string): ImportedScore {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message: string) => errors.push(message),
      fatalError: (message: string) => errors.push(message),
    },
  }).parseFromString(text, "application/xml") as unknown as Document | undefined;
  const root = document?.documentElement;
  if (errors.length > 0 || !root) {
    throw new MusicXmlImportError(`The score is not well-formed XML${errors[0] ? `: ${errors[0].trim()}` : ""}`);
  }
  if (root.localName !== "score-partwise" && root.localName !== "score-timewise") {
    throw new MusicXmlImportError("The file is not a MusicXML score");
  }
  const parts = partSources(root);
  const elementsByNote = new Map<NoteModel, Element>();
  const score = parseScore(root, parts, elementsByNote);
  const noteElements = new Map([...elementsByNote].map(([note, element]) => [note.key, element]));
  return { score, root, parts, noteElements };
}
