import type { Note as PianoFingeringNote } from "@lumikey/piano-fingering-model";

const DEFAULT_TEMPO_BPM = 120;
const FINGERING_CACHE_FIELD_NAME = "homr-piano-fingering-cache";
// Bump this whenever the model version or hand-assignment rules change.
const FINGERING_CACHE_VERSION = "lumikey-0.3.0-staff-hands-v1";
const STEP_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const BEAT_UNIT_QUARTERS: Readonly<Record<string, number>> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
};

export interface IndexedFingeringNote extends PianoFingeringNote {
  sourceIndex: number;
}

export interface PredictedFingering {
  finger: number;
  left: boolean;
}

export type FingeringPredictor = (
  notes: IndexedFingeringNote[],
) => Promise<IndexedFingeringNote[]>;

export interface MusicXmlFingeringResult {
  musicXml: string;
  fingeringsByMusicXmlId: Record<string, PredictedFingering>;
  noteCount: number;
}

interface RawNote {
  element: Element;
  musicXmlId: string | null;
  midi: number;
  left: boolean;
  measureIndex: number;
  offsetQuarters: number;
  durationQuarters: number;
}

interface RawTempo {
  bpm: number;
  measureIndex: number;
  offsetQuarters: number;
  order: number;
}

interface ParsedPart {
  notes: RawNote[];
  tempos: RawTempo[];
  measureLengths: number[];
}

interface TempoEvent {
  bpm: number;
  quarter: number;
  order: number;
}

function elements(element: Element): Element[] {
  return Array.from(element.childNodes).filter(
    (child): child is Element => child.nodeType === 1,
  );
}

function childrenNamed(element: Element, localName: string): Element[] {
  return elements(element).filter((child) => child.localName === localName);
}

function firstChild(element: Element, localName: string): Element | null {
  return elements(element).find((child) => child.localName === localName) ?? null;
}

function childText(element: Element, localName: string): string | null {
  return firstChild(element, localName)?.textContent?.trim() || null;
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationQuarters(element: Element, divisions: number): number | null {
  const duration = finiteNumber(childText(element, "duration"));
  if (duration === null || duration < 0 || divisions <= 0) return null;
  return duration / divisions;
}

function midiForNote(note: Element): number | null {
  const pitch = firstChild(note, "pitch");
  if (!pitch) return null;
  const step = childText(pitch, "step")?.toUpperCase();
  const octave = finiteNumber(childText(pitch, "octave"));
  const alter = finiteNumber(childText(pitch, "alter")) ?? 0;
  if (!step || STEP_SEMITONES[step] === undefined || octave === null) return null;
  const midi = (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
  return Number.isInteger(midi) && midi >= 21 && midi <= 108 ? midi : null;
}

function beatsInTimeSignature(time: Element): number | null {
  const beats = childText(time, "beats");
  const beatType = finiteNumber(childText(time, "beat-type"));
  if (!beats || beatType === null || beatType <= 0) return null;
  const beatCount = beats
    .split("+")
    .map(Number)
    .reduce((total, value) => total + value, 0);
  return Number.isFinite(beatCount) && beatCount > 0 ? beatCount * (4 / beatType) : null;
}

function tempoFromDirection(direction: Element): number | null {
  for (const descendant of Array.from(direction.getElementsByTagName("*"))) {
    if (descendant.localName === "sound") {
      const tempo = finiteNumber(descendant.getAttribute("tempo"));
      if (tempo !== null && tempo > 0) return tempo;
    }
  }
  for (const descendant of Array.from(direction.getElementsByTagName("*"))) {
    if (descendant.localName !== "metronome") continue;
    const perMinute = finiteNumber(childText(descendant, "per-minute"));
    if (perMinute === null || perMinute <= 0) continue;
    const beatUnit = childText(descendant, "beat-unit")?.toLowerCase() ?? "quarter";
    let quarterLength = BEAT_UNIT_QUARTERS[beatUnit] ?? 1;
    let dotAddition = quarterLength / 2;
    for (const dot of childrenNamed(descendant, "beat-unit-dot")) {
      quarterLength += dotAddition;
      dotAddition /= 2;
    }
    return perMinute * quarterLength;
  }
  return null;
}

function parsePart(part: Element, tempoOrder: { value: number }): ParsedPart {
  let divisions = 1;
  let nominalMeasureLength: number | null = null;
  const clefs = new Map<number, string>();
  const notes: RawNote[] = [];
  const tempos: RawTempo[] = [];
  const measureLengths: number[] = [];

  childrenNamed(part, "measure").forEach((measure, measureIndex) => {
    let cursor = 0;
    let furthestPosition = 0;
    let lastNoteStart = 0;

    for (const child of elements(measure)) {
      if (child.localName === "attributes") {
        const nextDivisions = finiteNumber(childText(child, "divisions"));
        if (nextDivisions !== null && nextDivisions > 0) divisions = nextDivisions;
        const time = firstChild(child, "time");
        if (time) nominalMeasureLength = beatsInTimeSignature(time);
        for (const clef of childrenNamed(child, "clef")) {
          const staff = finiteNumber(clef.getAttribute("number")) ?? 1;
          const sign = childText(clef, "sign")?.toUpperCase();
          if (Number.isInteger(staff) && staff > 0 && sign) clefs.set(staff, sign);
        }
        continue;
      }

      if (child.localName === "backup" || child.localName === "forward") {
        const duration = durationQuarters(child, divisions);
        if (duration === null) continue;
        cursor = child.localName === "backup" ? Math.max(0, cursor - duration) : cursor + duration;
        furthestPosition = Math.max(furthestPosition, cursor);
        continue;
      }

      if (child.localName === "direction" || child.localName === "sound") {
        const tempo = child.localName === "sound"
          ? finiteNumber(child.getAttribute("tempo"))
          : tempoFromDirection(child);
        if (tempo !== null && tempo > 0) {
          const offset = child.localName === "direction"
            ? (finiteNumber(childText(child, "offset")) ?? 0) / divisions
            : 0;
          tempos.push({
            bpm: tempo,
            measureIndex,
            offsetQuarters: Math.max(0, cursor + offset),
            order: tempoOrder.value,
          });
          tempoOrder.value += 1;
        }
        continue;
      }

      if (child.localName !== "note") continue;
      const duration = durationQuarters(child, divisions);
      if (duration === null) continue;
      const chord = firstChild(child, "chord") !== null;
      const onset = chord ? lastNoteStart : cursor;
      if (!chord) {
        lastNoteStart = onset;
        cursor += duration;
      }
      furthestPosition = Math.max(furthestPosition, onset + duration, cursor);

      const midi = midiForNote(child);
      if (midi === null) continue;
      const staff = finiteNumber(childText(child, "staff")) ?? 1;
      const clef = clefs.get(staff);
      notes.push({
        element: child,
        musicXmlId: child.getAttribute("id"),
        midi,
        left: staff > 1 || clef === "F",
        measureIndex,
        offsetQuarters: onset,
        durationQuarters: duration,
      });
    }

    measureLengths.push(
      furthestPosition > 0 ? furthestPosition : (nominalMeasureLength ?? 0),
    );
  });

  return { notes, tempos, measureLengths };
}

function measureStarts(parts: ParsedPart[]): number[] {
  const measureCount = Math.max(0, ...parts.map((part) => part.measureLengths.length));
  const lengths = Array.from({ length: measureCount }, (_, measureIndex) =>
    Math.max(0, ...parts.map((part) => part.measureLengths[measureIndex] ?? 0)),
  );
  const starts: number[] = [];
  let cursor = 0;
  for (const length of lengths) {
    starts.push(cursor);
    cursor += length;
  }
  return starts;
}

function tempoEvents(parts: ParsedPart[], starts: number[]): TempoEvent[] {
  const candidates = parts
    .flatMap((part) => part.tempos)
    .map((tempo) => ({
      bpm: tempo.bpm,
      quarter: (starts[tempo.measureIndex] ?? 0) + tempo.offsetQuarters,
      order: tempo.order,
    }))
    .sort((first, second) => first.quarter - second.quarter || first.order - second.order);
  return [{ bpm: DEFAULT_TEMPO_BPM, quarter: 0, order: -1 }, ...candidates];
}

function millisecondsAtQuarter(quarter: number, tempos: TempoEvent[]): number {
  let milliseconds = 0;
  let previousQuarter = 0;
  let bpm = DEFAULT_TEMPO_BPM;
  for (const tempo of tempos) {
    if (tempo.quarter > quarter) break;
    milliseconds += (tempo.quarter - previousQuarter) * (60_000 / bpm);
    previousQuarter = tempo.quarter;
    bpm = tempo.bpm;
  }
  return milliseconds + (quarter - previousQuarter) * (60_000 / bpm);
}

function modelNotes(parts: ParsedPart[]): { indexed: IndexedFingeringNote[]; raw: RawNote[] } {
  const starts = measureStarts(parts);
  const tempos = tempoEvents(parts, starts);
  const raw = parts.flatMap((part) => part.notes);
  const indexed = raw.map((note, sourceIndex) => {
    const startQuarter = (starts[note.measureIndex] ?? 0) + note.offsetQuarters;
    const endQuarter = startQuarter + note.durationQuarters;
    const start = millisecondsAtQuarter(startQuarter, tempos);
    const end = millisecondsAtQuarter(endQuarter, tempos);
    return {
      left: note.left,
      note: note.midi,
      time: Math.round(start),
      duration: Math.max(0, Math.round(end - start)),
      sourceIndex,
    };
  });
  return { indexed, raw };
}

function musicXmlDocument(musicXml: string): XMLDocument {
  if (typeof DOMParser === "undefined") {
    throw new Error("MusicXML parsing is unavailable in this runtime");
  }
  const document = new DOMParser().parseFromString(musicXml, "application/xml");
  const parserError = Array.from(document.getElementsByTagName("*")).find(
    (element) => element.localName === "parsererror",
  );
  if (parserError || document.documentElement.localName !== "score-partwise") {
    throw new Error("The generated score is not valid partwise MusicXML");
  }
  return document;
}

function createMusicXmlElement(note: Element, localName: string): Element {
  const prefix = note.prefix ? `${note.prefix}:` : "";
  return note.ownerDocument.createElementNS(note.namespaceURI, `${prefix}${localName}`);
}

function replaceFingering(note: Element, finger: number): void {
  let notations = firstChild(note, "notations");
  if (!notations) {
    notations = createMusicXmlElement(note, "notations");
    const laterChild = elements(note).find((child) =>
      child.localName === "lyric" || child.localName === "play" || child.localName === "listen",
    );
    note.insertBefore(notations, laterChild ?? null);
  }
  let technical = firstChild(notations, "technical");
  if (!technical) {
    technical = createMusicXmlElement(note, "technical");
    notations.appendChild(technical);
  }
  for (const existing of childrenNamed(technical, "fingering")) {
    technical.removeChild(existing);
  }
  const fingering = createMusicXmlElement(note, "fingering");
  fingering.textContent = String(finger);
  technical.appendChild(fingering);
}

function fingeringForNote(note: Element): number | null {
  for (const notations of childrenNamed(note, "notations")) {
    for (const technical of childrenNamed(notations, "technical")) {
      for (const fingering of childrenNamed(technical, "fingering")) {
        const finger = finiteNumber(fingering.textContent);
        if (finger !== null && Number.isInteger(finger) && finger >= 1 && finger <= 5) {
          return finger;
        }
      }
    }
  }
  return null;
}

function fingeringCacheField(document: XMLDocument): Element | null {
  const identification = firstChild(document.documentElement, "identification");
  const miscellaneous = identification && firstChild(identification, "miscellaneous");
  return miscellaneous
    ? childrenNamed(miscellaneous, "miscellaneous-field").find(
        (field) => field.getAttribute("name") === FINGERING_CACHE_FIELD_NAME,
      ) ?? null
    : null;
}

function markFingeringCacheCurrent(document: XMLDocument): void {
  const score = document.documentElement;
  let identification = firstChild(score, "identification");
  if (!identification) {
    identification = createMusicXmlElement(score, "identification");
    const laterChild = elements(score).find((child) =>
      child.localName === "defaults" ||
      child.localName === "credit" ||
      child.localName === "part-list" ||
      child.localName === "part",
    );
    score.insertBefore(identification, laterChild ?? null);
  }
  let miscellaneous = firstChild(identification, "miscellaneous");
  if (!miscellaneous) {
    miscellaneous = createMusicXmlElement(identification, "miscellaneous");
    identification.appendChild(miscellaneous);
  }
  let field = childrenNamed(miscellaneous, "miscellaneous-field").find(
    (candidate) => candidate.getAttribute("name") === FINGERING_CACHE_FIELD_NAME,
  );
  if (!field) {
    field = createMusicXmlElement(miscellaneous, "miscellaneous-field");
    field.setAttribute("name", FINGERING_CACHE_FIELD_NAME);
    miscellaneous.appendChild(field);
  }
  field.textContent = FINGERING_CACHE_VERSION;
}

function serializeMusicXml(document: XMLDocument): string {
  if (typeof XMLSerializer === "undefined") {
    throw new Error("MusicXML serialization is unavailable in this runtime");
  }
  const serialized = new XMLSerializer().serializeToString(document);
  return /^\s*<\?xml/.test(serialized)
    ? serialized
    : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

export function cachedFingeringsFromMusicXml(
  musicXml: string,
): MusicXmlFingeringResult | null {
  const document = musicXmlDocument(musicXml);
  if (fingeringCacheField(document)?.textContent?.trim() !== FINGERING_CACHE_VERSION) {
    return null;
  }

  const tempoOrder = { value: 0 };
  const parts = childrenNamed(document.documentElement, "part").map((part) =>
    parsePart(part, tempoOrder),
  );
  const { indexed, raw } = modelNotes(parts);
  const fingeringsByMusicXmlId: Record<string, PredictedFingering> = {};
  for (const source of raw) {
    const finger = fingeringForNote(source.element);
    if (finger === null) return null;
    if (source.musicXmlId) {
      fingeringsByMusicXmlId[source.musicXmlId] = { finger, left: source.left };
    }
  }
  return {
    musicXml,
    fingeringsByMusicXmlId,
    noteCount: indexed.length,
  };
}

export async function addPredictedFingeringsToMusicXml(
  musicXml: string,
  predict: FingeringPredictor,
): Promise<MusicXmlFingeringResult> {
  const document = musicXmlDocument(musicXml);
  const tempoOrder = { value: 0 };
  const parts = childrenNamed(document.documentElement, "part").map((part) =>
    parsePart(part, tempoOrder),
  );
  const { indexed, raw } = modelNotes(parts);
  if (indexed.length === 0) {
    return { musicXml, fingeringsByMusicXmlId: {}, noteCount: 0 };
  }

  const predictions = await predict(indexed);
  const fingeringsByMusicXmlId: Record<string, PredictedFingering> = {};
  let annotatedCount = 0;
  for (const prediction of predictions) {
    const source = raw[prediction.sourceIndex];
    const finger = prediction.finger;
    if (
      !source ||
      typeof finger !== "number" ||
      !Number.isInteger(finger) ||
      finger < 1 ||
      finger > 5
    ) continue;
    replaceFingering(source.element, finger);
    annotatedCount += 1;
    if (source.musicXmlId) {
      fingeringsByMusicXmlId[source.musicXmlId] = { finger, left: source.left };
    }
  }
  if (annotatedCount !== indexed.length) {
    throw new Error(
      `The fingering model returned ${annotatedCount} usable predictions for ${indexed.length} notes`,
    );
  }
  markFingeringCacheCurrent(document);

  return {
    musicXml: serializeMusicXml(document),
    fingeringsByMusicXmlId,
    noteCount: annotatedCount,
  };
}
