import { DOMParser } from "@xmldom/xmldom";
import { formatPitchName } from "./noteLabels";
import type {
  DocumentPage,
  VisualBBox,
  VisualGroup,
  VisualGroupRef,
} from "./types";
import { isLinkedVisualGroup } from "./types";

export type PlaybackMode = "note-by-note" | "realtime";
export type PlaybackStatus = "inactive" | "note-by-note" | "playing" | "paused";

export type RealtimeTremoloType = "single" | "start" | "stop" | "unmeasured";

export interface RealtimeTremolo {
  type: RealtimeTremoloType;
  marks: number;
  beamCount: number;
}

export type RealtimeTrillStartNote = "main" | "upper" | "below";

export interface RealtimeTrill {
  auxiliaryPitch: string;
  lowerPitch: string;
  startNote: RealtimeTrillStartNote;
  beats: number | null;
  accelerate: boolean;
}

export interface RealtimeScoreNote {
  musicXmlId: string;
  partId: string;
  voice: string;
  staff: number;
  pitch: string;
  onset: number;
  duration: number;
  grace: boolean;
  tieStart: boolean;
  tieStop: boolean;
  inferredTieGroup: string | null;
  tremolo: RealtimeTremolo | null;
  trill: RealtimeTrill | null;
}

export function scoreNoteStartsAttack(note: RealtimeScoreNote): boolean {
  return !note.grace && !note.tieStop;
}

export interface RealtimeTempoChange {
  onset: number;
  bpm: number;
}

export interface RealtimeScoreEvent {
  onset: number;
  notes: RealtimeScoreNote[];
  pitches: string[];
}

export interface RepeatMark {
  times: number;
  afterJump: boolean;
}

export interface NavigationSound {
  id: string;
  dacapo: boolean;
  dalsegno: string | null;
  tocoda: string | null;
  fine: string | null;
  segno: string | null;
  coda: string | null;
  forwardRepeat: boolean;
  timeOnly: ReadonlySet<number> | null;
}

export interface StructuralMeasure {
  index: number;
  number: string;
  pageNumber: number;
  duration: number;
  notes: RealtimeScoreNote[];
  events: RealtimeScoreEvent[];
  tempos: RealtimeTempoChange[];
  forwardRepeat: boolean;
  backwardRepeat: RepeatMark | null;
  endingNumbers: ReadonlySet<number>;
  sounds: NavigationSound[];
}

export interface RealtimeScore {
  measures: StructuralMeasure[];
}

export interface VisualNoteTarget extends VisualGroupRef {
  musicXmlId: string;
  staffIndex: number;
  x: number;
  y: number;
  systemRight: number;
  systemTop: number;
  systemBottom: number;
}

export interface PerformanceNote {
  id: string;
  musicXmlId: string;
  pitch: string;
  onset: number;
  release: number;
  visual: VisualNoteTarget | null;
  fingeringMusicXmlId?: string | null;
}

export interface PerformanceOccurrence {
  id: string;
  routeIndex: number;
  measureIndex: number;
  measureNumber: string;
  pageNumber: number;
  pass: number;
  scoreStart: number;
  scoreEnd: number;
  localStart: number;
}

export interface PerformanceEvent {
  onset: number;
  notes: PerformanceNote[];
  pitches: string[];
}

export interface TempoSegment {
  offset: number;
  bpm: number;
}

export interface PerformanceRoute {
  occurrences: PerformanceOccurrence[];
  notes: PerformanceNote[];
  playheadNotes?: PerformanceNote[];
  events: PerformanceEvent[];
  tempoSegments: TempoSegment[];
  totalQuarters: number;
}

export interface ExpandRouteOptions {
  startMeasureIndex?: number;
  startOffset?: number;
  visualMap?: ReadonlyMap<string, VisualNoteTarget>;
  maxMeasureVisits?: number;
  maxOccurrences?: number;
}

export interface StructuralPosition {
  measureIndex: number;
  onset: number;
}

export type StructuralSeekCommand =
  | "forwardNote"
  | "backwardNote"
  | "forwardBar"
  | "backwardBar"
  | "forwardPage"
  | "backwardPage";

export interface RealtimePlayhead {
  pageIndex: number;
  staffIndex: number;
  x: number;
  y1: number;
  y2: number;
}

export interface RealtimeFrame {
  status: "playing" | "paused";
  offset: number;
  bpm: number;
  activeNotes: PerformanceNote[];
  playhead: RealtimePlayhead | null;
}

function elements(parent: Element | Document, name?: string): Element[] {
  const result: Element[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (!name || element.localName === name || element.nodeName.split(":").at(-1) === name) {
      result.push(element);
    }
  }
  return result;
}

function descendants(parent: Element | Document, name: string): Element[] {
  return Array.from(parent.getElementsByTagName("*"))
    .filter((element) => element.localName === name || element.nodeName.split(":").at(-1) === name);
}

function first(parent: Element, name: string): Element | null {
  return elements(parent, name)[0] ?? null;
}

function text(parent: Element, name: string): string | null {
  return first(parent, name)?.textContent?.trim() || null;
}

function finiteNumber(value: string | null, fallback = 0): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function yes(value: string | null): boolean {
  return value === "yes" || value === "true" || value === "1";
}

function parseTimeOnly(value: string | null): ReadonlySet<number> | null {
  if (!value) return null;
  const result = new Set<number>();
  for (const token of value.split(/[ ,]+/)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let number = start; number <= end && number - start < 100; number += 1) result.add(number);
      continue;
    }
    const number = Number(token);
    if (Number.isInteger(number) && number > 0) result.add(number);
  }
  return result.size > 0 ? result : null;
}

function parseSound(element: Element, measureIndex: number, soundIndex: number): NavigationSound {
  return {
    id: `${measureIndex}:${soundIndex}`,
    dacapo: yes(element.getAttribute("dacapo")),
    dalsegno: element.getAttribute("dalsegno"),
    tocoda: element.getAttribute("tocoda"),
    fine: element.getAttribute("fine"),
    segno: element.getAttribute("segno"),
    coda: element.getAttribute("coda"),
    forwardRepeat: yes(element.getAttribute("forward-repeat")),
    timeOnly: parseTimeOnly(element.getAttribute("time-only")),
  };
}

const BEAT_UNIT_QUARTERS: Readonly<Record<string, number>> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
};

const NOTE_TYPE_BEAMS: Readonly<Record<string, number>> = {
  eighth: 1,
  "16th": 2,
  "32nd": 3,
  "64th": 4,
  "128th": 5,
  "256th": 6,
  "512th": 7,
  "1024th": 8,
};

const PITCH_STEP_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const PITCH_STEPS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const SHARP_KEY_ORDER = ["F", "C", "G", "D", "A", "E", "B"] as const;
const FLAT_KEY_ORDER = ["B", "E", "A", "D", "G", "C", "F"] as const;

function keyAlter(step: string, fifths: number): number {
  const direction = Math.sign(fifths);
  if (direction === 0) return 0;
  const order: readonly string[] = direction > 0 ? SHARP_KEY_ORDER : FLAT_KEY_ORDER;
  const index = order.indexOf(step.toUpperCase());
  const count = Math.abs(Math.trunc(fifths));
  if (index < 0 || count <= index) return 0;
  return direction * (Math.floor((count - index - 1) / order.length) + 1);
}

function adjacentDiatonicPitch(
  step: string,
  octave: number,
  direction: -1 | 1,
  fifths: number,
): { step: string; octave: number; alter: number } {
  const index = PITCH_STEPS.indexOf(step.toUpperCase() as typeof PITCH_STEPS[number]);
  const safeIndex = index >= 0 ? index : 0;
  const adjacentIndex = (safeIndex + direction + PITCH_STEPS.length) % PITCH_STEPS.length;
  const adjacentStep = PITCH_STEPS[adjacentIndex];
  const octaveChange = direction > 0 && adjacentIndex === 0
    ? 1
    : direction < 0 && adjacentIndex === PITCH_STEPS.length - 1
      ? -1
      : 0;
  return {
    step: adjacentStep,
    octave: octave + octaveChange,
    alter: keyAlter(adjacentStep, fifths),
  };
}

function pitchSemitone(step: string, octave: number, alter: number): number {
  return (octave + 1) * 12 + (PITCH_STEP_SEMITONES[step.toUpperCase()] ?? 0) + alter;
}

function accidentalAlter(value: string | null): number | null {
  switch (value?.trim().toLowerCase()) {
    case "sharp": return 1;
    case "flat": return -1;
    case "natural": return 0;
    case "double-sharp":
    case "sharp-sharp": return 2;
    case "flat-flat": return -2;
    default: return null;
  }
}

function trillAdjacentPitch(
  step: string,
  octave: number,
  alter: number,
  direction: -1 | 1,
  fifths: number,
  trillStep: string | null,
  accidental: number | null,
): string {
  if (trillStep === "unison") return formatPitchName(step, octave, alter);
  const adjacent = adjacentDiatonicPitch(step, octave, direction, fifths);
  if (trillStep === "half" || trillStep === "whole") {
    const semitones = trillStep === "half" ? 1 : 2;
    const target = pitchSemitone(step, octave, alter) + direction * semitones;
    adjacent.alter = target - pitchSemitone(adjacent.step, adjacent.octave, 0);
  }
  if (accidental !== null && direction > 0) adjacent.alter = accidental;
  return formatPitchName(adjacent.step, adjacent.octave, adjacent.alter);
}

function parseTrill(
  note: Element,
  step: string,
  octave: number,
  alter: number,
  fifths: number,
): RealtimeTrill | null {
  const element = descendants(note, "trill-mark")[0];
  if (!element) return null;
  const rawStart = element.getAttribute("start-note");
  const startNote: RealtimeTrillStartNote = rawStart === "upper" || rawStart === "below"
    ? rawStart
    : "main";
  const rawBeats = element.getAttribute("beats");
  const parsedBeats = rawBeats === null ? null : finiteNumber(rawBeats, 0);
  const ornaments = descendants(note, "ornaments")
    .find((candidate) => descendants(candidate, "trill-mark").includes(element));
  const accidental = accidentalAlter(
    ornaments ? descendants(ornaments, "accidental-mark")[0]?.textContent ?? null : null,
  );
  const trillStep = element.getAttribute("trill-step");
  return {
    auxiliaryPitch: trillAdjacentPitch(
      step,
      octave,
      alter,
      1,
      fifths,
      trillStep,
      accidental,
    ),
    lowerPitch: trillAdjacentPitch(step, octave, alter, -1, fifths, trillStep, null),
    startNote,
    beats: parsedBeats !== null && parsedBeats > 0
      ? Math.min(4096, Math.max(1, Math.round(parsedBeats)))
      : null,
    accelerate: yes(element.getAttribute("accelerate")),
  };
}

function parseTremolo(note: Element): RealtimeTremolo | null {
  const element = descendants(note, "tremolo")[0];
  if (!element) return null;
  const rawType = element.getAttribute("type") ?? "single";
  const type: RealtimeTremoloType =
    rawType === "start" || rawType === "stop" || rawType === "unmeasured"
      ? rawType
      : "single";
  const fallbackMarks = type === "unmeasured" ? 0 : 3;
  const marks = Math.min(8, Math.max(
    0,
    Math.trunc(finiteNumber(element.textContent, fallbackMarks)),
  ));
  const explicitBeamNumbers = new Set(
    elements(note, "beam").map((beam) => beam.getAttribute("number") ?? "1"),
  );
  const typeBeamCount = NOTE_TYPE_BEAMS[text(note, "type")?.toLowerCase() ?? ""] ?? 0;
  return {
    type,
    marks,
    beamCount: Math.max(typeBeamCount, explicitBeamNumbers.size),
  };
}

function metronomeTempo(direction: Element): number | null {
  const metronome = descendants(direction, "metronome")[0];
  if (!metronome) return null;
  const perMinute = finiteNumber(text(metronome, "per-minute"));
  if (perMinute <= 0) return null;
  let beatLength = BEAT_UNIT_QUARTERS[text(metronome, "beat-unit")?.toLowerCase() ?? "quarter"] ?? 1;
  let dot = beatLength / 2;
  for (const _dot of elements(metronome, "beat-unit-dot")) {
    beatLength += dot;
    dot /= 2;
  }
  return perMinute * beatLength;
}

interface PartMeasureData {
  number: string;
  pageNumber: number;
  duration: number;
  notes: ParsedScoreNote[];
  tempos: RealtimeTempoChange[];
  forwardRepeat: boolean;
  backwardRepeat: RepeatMark | null;
  endingStarts: ReadonlySet<number> | null;
  endingStops: boolean;
  sounds: NavigationSound[];
}

interface ParsedScoreNote extends RealtimeScoreNote {
  voiceEventIndex: number;
  slurStarts: string[];
  slurStops: string[];
}

function endingNumbers(value: string | null): ReadonlySet<number> {
  const result = new Set<number>();
  for (const token of (value ?? "").split(/[ ,]+/)) {
    const number = Number.parseInt(token, 10);
    if (Number.isInteger(number) && number > 0) result.add(number);
  }
  return result;
}

function scoreEvents(notes: RealtimeScoreNote[]): RealtimeScoreEvent[] {
  const byOnset = new Map<number, RealtimeScoreNote[]>();
  for (const note of notes) {
    const grouped = byOnset.get(note.onset) ?? [];
    grouped.push(note);
    byOnset.set(note.onset, grouped);
  }
  return [...byOnset]
    .sort(([left], [right]) => left - right)
    .map(([onset, grouped]) => ({
      onset,
      notes: grouped,
      pitches: Array.from(new Set(grouped.map((note) => note.pitch))),
    }));
}

function slurKey(note: ParsedScoreNote, number: string): string {
  return `${note.staff}:${number}`;
}

function voiceEventKey(note: ParsedScoreNote): string {
  return `${note.staff}:${note.voice}:${note.voiceEventIndex}`;
}

function inferSamePitchSlurTies(measures: PartMeasureData[]): void {
  const activeSlurs = new Map<string, ParsedScoreNote>();
  const notesByVoiceEvent = new Map<string, ParsedScoreNote[]>();
  const absoluteOnsets = new Map<ParsedScoreNote, number>();
  let measureStart = 0;
  for (const measure of measures) {
    for (const note of measure.notes) {
      const key = voiceEventKey(note);
      const eventNotes = notesByVoiceEvent.get(key) ?? [];
      eventNotes.push(note);
      notesByVoiceEvent.set(key, eventNotes);
      absoluteOnsets.set(note, measureStart + note.onset);
    }
    measureStart += measure.duration;
  }
  for (const measure of measures) {
    for (const note of measure.notes) {
      for (const number of note.slurStops) {
        const key = slurKey(note, number);
        const start = activeSlurs.get(key);
        const startOnset = start ? absoluteOnsets.get(start) : undefined;
        const stopOnset = absoluteOnsets.get(note);
        const adjacentInVoice =
          start?.voice === note.voice &&
          note.voiceEventIndex === start.voiceEventIndex + 1;
        const rhythmicallyContiguous =
          startOnset !== undefined &&
          stopOnset !== undefined &&
          Math.abs(stopOnset - (startOnset + (start?.duration ?? 0))) <= 1e-6;
        if (
          start &&
          !start.grace &&
          !note.grace &&
          start.pitch === note.pitch &&
          (adjacentInVoice || rhythmicallyContiguous)
        ) {
          const startNotes = notesByVoiceEvent.get(voiceEventKey(start)) ?? [start];
          const stopNotes = notesByVoiceEvent.get(voiceEventKey(note)) ?? [note];
          const inferredTieGroup = `slur:${start.partId}:${start.staff}:${number}`;
          const unusedStops = new Map<string, ParsedScoreNote[]>();
          for (const stopNote of stopNotes) {
            const matching = unusedStops.get(stopNote.pitch) ?? [];
            matching.push(stopNote);
            unusedStops.set(stopNote.pitch, matching);
          }
          for (const startNote of startNotes) {
            const matching = unusedStops.get(startNote.pitch)?.shift();
            if (!matching || startNote.grace || matching.grace) continue;
            startNote.tieStart = true;
            startNote.inferredTieGroup = inferredTieGroup;
            matching.tieStop = true;
            matching.inferredTieGroup = inferredTieGroup;
          }
        }
        activeSlurs.delete(key);
      }
      for (const number of note.slurStarts) {
        activeSlurs.set(slurKey(note, number), note);
      }
    }
  }
}

function parsePartMeasure(
  measure: Element,
  partId: string,
  measureIndex: number,
  divisionsAtStart: number,
  pageAtStart: number,
  fifthsAtStart: number,
  includeNavigation: boolean,
  voiceEventIndexes: Map<string, number>,
): { data: PartMeasureData; divisions: number; pageNumber: number; fifths: number } {
  let divisions = divisionsAtStart;
  let pageNumber = pageAtStart;
  let fifths = fifthsAtStart;
  let cursor = 0;
  let furthest = 0;
  let chordOnset = 0;
  const notes: ParsedScoreNote[] = [];
  const tempos: RealtimeTempoChange[] = [];
  const sounds: NavigationSound[] = [];
  let soundIndex = 0;

  for (const child of elements(measure)) {
    if (child.localName === "print" || child.nodeName.endsWith(":print")) {
      if (yes(child.getAttribute("new-page"))) {
        pageNumber = Math.max(1, finiteNumber(child.getAttribute("page-number"), pageNumber + 1));
      }
      continue;
    }
    if (child.localName === "attributes" || child.nodeName.endsWith(":attributes")) {
      const value = finiteNumber(text(child, "divisions"), divisions);
      if (value > 0) divisions = value;
      const key = elements(child, "key")[0];
      if (key) fifths = Math.trunc(finiteNumber(text(key, "fifths"), fifths));
      continue;
    }
    if (child.localName === "backup" || child.nodeName.endsWith(":backup")) {
      cursor = Math.max(0, cursor - finiteNumber(text(child, "duration")) / divisions);
      continue;
    }
    if (child.localName === "forward" || child.nodeName.endsWith(":forward")) {
      cursor += finiteNumber(text(child, "duration")) / divisions;
      furthest = Math.max(furthest, cursor);
      continue;
    }
    if (child.localName === "note" || child.nodeName.endsWith(":note")) {
      const duration = Math.max(0, finiteNumber(text(child, "duration")) / divisions);
      const isChord = first(child, "chord") !== null;
      const onset = isChord ? chordOnset : cursor;
      if (!isChord) chordOnset = onset;
      const voice = text(child, "voice") ?? "1";
      const staff = Math.max(1, finiteNumber(text(child, "staff"), 1));
      const voiceKey = `${staff}:${voice}`;
      const nextVoiceEventIndex = voiceEventIndexes.get(voiceKey) ?? 0;
      const voiceEventIndex = isChord
        ? Math.max(0, nextVoiceEventIndex - 1)
        : nextVoiceEventIndex;
      if (!isChord) voiceEventIndexes.set(voiceKey, nextVoiceEventIndex + 1);
      const pitchElement = first(child, "pitch");
      if (pitchElement) {
        const step = text(pitchElement, "step");
        const octave = text(pitchElement, "octave");
        const alter = finiteNumber(text(pitchElement, "alter"));
        if (step && octave !== null) {
          const octaveNumber = Math.trunc(finiteNumber(octave, 4));
          const tieTypes = new Set(elements(child, "tie").map((tie) => tie.getAttribute("type")));
          for (const tied of descendants(child, "tied")) tieTypes.add(tied.getAttribute("type"));
          const slurs = descendants(child, "slur");
          notes.push({
            musicXmlId: child.getAttribute("id") ?? `${partId}-m${measureIndex}-n${notes.length}`,
            partId,
            voice,
            staff,
            pitch: formatPitchName(step, octave, alter),
            onset,
            duration,
            grace: first(child, "grace") !== null,
            tieStart: tieTypes.has("start"),
            tieStop: tieTypes.has("stop"),
            inferredTieGroup: null,
            voiceEventIndex,
            slurStarts: slurs
              .filter((slur) => slur.getAttribute("type") === "start")
              .map((slur) => slur.getAttribute("number") ?? "1"),
            slurStops: slurs
              .filter((slur) => slur.getAttribute("type") === "stop")
              .map((slur) => slur.getAttribute("number") ?? "1"),
            tremolo: parseTremolo(child),
            trill: parseTrill(child, step, octaveNumber, alter, fifths),
          });
        }
      }
      if (!isChord) cursor += duration;
      furthest = Math.max(furthest, onset + duration, cursor);
      continue;
    }
    if (child.localName === "direction" || child.nodeName.endsWith(":direction")) {
      const offset = finiteNumber(text(child, "offset")) / divisions;
      let foundSoundTempo = false;
      for (const sound of descendants(child, "sound")) {
        const tempo = finiteNumber(sound.getAttribute("tempo"));
        if (tempo > 0) {
          tempos.push({ onset: Math.max(0, cursor + offset), bpm: tempo });
          foundSoundTempo = true;
        }
        if (includeNavigation) sounds.push(parseSound(sound, measureIndex, soundIndex++));
      }
      if (!foundSoundTempo) {
        const tempo = metronomeTempo(child);
        if (tempo !== null) tempos.push({ onset: Math.max(0, cursor + offset), bpm: tempo });
      }
      continue;
    }
    if (child.localName === "sound" || child.nodeName.endsWith(":sound")) {
      const offset = finiteNumber(text(child, "offset")) / divisions;
      const tempo = finiteNumber(child.getAttribute("tempo"));
      if (tempo > 0) tempos.push({ onset: Math.max(0, cursor + offset), bpm: tempo });
      if (includeNavigation) sounds.push(parseSound(child, measureIndex, soundIndex++));
    }
  }

  let forwardRepeat = false;
  let backwardRepeat: RepeatMark | null = null;
  let endingStarts: ReadonlySet<number> | null = null;
  let endingStops = false;
  if (includeNavigation) {
    for (const barline of elements(measure, "barline")) {
      for (const repeat of elements(barline, "repeat")) {
        if (repeat.getAttribute("direction") === "forward") forwardRepeat = true;
        if (repeat.getAttribute("direction") === "backward") {
          backwardRepeat = {
            times: Math.max(1, finiteNumber(repeat.getAttribute("times"), 2)),
            afterJump: yes(repeat.getAttribute("after-jump")),
          };
        }
      }
      for (const ending of elements(barline, "ending")) {
        const type = ending.getAttribute("type");
        if (type === "start") endingStarts = endingNumbers(ending.getAttribute("number"));
        if (type === "stop" || type === "discontinue") endingStops = true;
      }
    }
  }
  if (sounds.some((sound) => sound.forwardRepeat)) forwardRepeat = true;

  return {
    data: {
      number: measure.getAttribute("number") ?? String(measureIndex + 1),
      pageNumber,
      duration: furthest,
      notes,
      tempos,
      forwardRepeat,
      backwardRepeat,
      endingStarts,
      endingStops,
      sounds,
    },
    divisions,
    pageNumber,
    fifths,
  };
}

export function parseRealtimeMusicXml(musicXml: string): RealtimeScore {
  const document = new DOMParser().parseFromString(musicXml, "application/xml") as unknown as Document;
  const root = document.documentElement;
  if (!root || (root.localName ?? root.nodeName) !== "score-partwise") {
    throw new Error("Realtime playback requires a valid partwise MusicXML score.");
  }
  if (descendants(document, "parsererror").length > 0) {
    throw new Error("The merged MusicXML could not be parsed for realtime playback.");
  }
  const parts = elements(root, "part");
  if (parts.length === 0) throw new Error("The merged MusicXML contains no playable parts.");

  const partMeasures: PartMeasureData[][] = [];
  parts.forEach((part, partIndex) => {
    let divisions = 1;
    let pageNumber = 1;
    let fifths = 0;
    const voiceEventIndexes = new Map<string, number>();
    const parsed: PartMeasureData[] = [];
    elements(part, "measure").forEach((measure, measureIndex) => {
      const result = parsePartMeasure(
        measure,
        part.getAttribute("id") ?? `P${partIndex + 1}`,
        measureIndex,
        divisions,
        pageNumber,
        fifths,
        true,
        voiceEventIndexes,
      );
      divisions = result.divisions;
      pageNumber = result.pageNumber;
      fifths = result.fifths;
      parsed.push(result.data);
    });
    inferSamePitchSlurTies(parsed);
    partMeasures.push(parsed);
  });

  const measureCount = Math.max(...partMeasures.map((part) => part.length));
  const measures: StructuralMeasure[] = [];
  let activeEnding = new Set<number>();
  for (let index = 0; index < measureCount; index += 1) {
    const available = partMeasures.flatMap((part) => part[index] ? [part[index]] : []);
    const navigation = partMeasures[0][index];
    const endingStart = available.find((measure) => measure.endingStarts)?.endingStarts;
    if (endingStart) activeEnding = new Set(endingStart);
    const measureSounds = available
      .flatMap((measure) => measure.sounds)
      .filter((sound, soundIndex, all) => all.findIndex((candidate) =>
        candidate.dacapo === sound.dacapo &&
        candidate.dalsegno === sound.dalsegno &&
        candidate.tocoda === sound.tocoda &&
        candidate.fine === sound.fine &&
        candidate.segno === sound.segno &&
        candidate.coda === sound.coda &&
        candidate.forwardRepeat === sound.forwardRepeat &&
        String(candidate.timeOnly ? [...candidate.timeOnly] : "") ===
          String(sound.timeOnly ? [...sound.timeOnly] : ""),
      ) === soundIndex);
    const measureNotes = available.flatMap((measure) => measure.notes);
    measures.push({
      index,
      number: navigation?.number ?? available[0]?.number ?? String(index + 1),
      pageNumber: navigation?.pageNumber ?? available[0]?.pageNumber ?? 1,
      duration: Math.max(0, ...available.map((measure) => measure.duration)),
      notes: measureNotes,
      events: scoreEvents(measureNotes),
      tempos: available
        .flatMap((measure) => measure.tempos)
        .filter((tempo, tempoIndex, all) =>
          all.findIndex((candidate) => candidate.onset === tempo.onset && candidate.bpm === tempo.bpm) === tempoIndex,
        )
        .sort((left, right) => left.onset - right.onset),
      forwardRepeat: available.some((measure) => measure.forwardRepeat),
      backwardRepeat: available.find((measure) => measure.backwardRepeat)?.backwardRepeat ?? null,
      endingNumbers: new Set(activeEnding),
      sounds: measureSounds,
    });
    if (available.some((measure) => measure.endingStops)) activeEnding = new Set<number>();
  }
  return { measures };
}

export function buildRealtimeVisualMap(pages: DocumentPage[]): Map<string, VisualNoteTarget> {
  const result = new Map<string, VisualNoteTarget>();
  let musicPageNumber = 0;
  for (const page of [...pages].sort((left, right) => left.index - right.index)) {
    if (page.musicXml || page.visualSidecar || page.artifacts?.musicXmlPath) musicPageNumber += 1;
    const sidecar = page.visualSidecar;
    if (!sidecar) continue;
    const eligibleGroups = sidecar.visual_groups.filter(isLinkedVisualGroup);
    const groups = new Map(
      eligibleGroups.map((group) => [group.visual_group_id, group]),
    );
    const systems = new Map<number, { right: number; top: number; bottom: number }>();
    for (const group of eligibleGroups) {
      const bounds = bbox(group);
      const system = systems.get(group.staff_index);
      if (system) {
        system.right = Math.max(system.right, bounds[2] + 12);
        system.top = Math.min(system.top, bounds[1] - 18);
        system.bottom = Math.max(system.bottom, bounds[3] + 18);
      } else {
        systems.set(group.staff_index, {
          right: bounds[2] + 12,
          top: bounds[1] - 18,
          bottom: bounds[3] + 18,
        });
      }
    }
    for (const note of sidecar.notes) {
      if (!note.visual_group_id) continue;
      const group = groups.get(note.visual_group_id);
      if (!group) continue;
      const system = systems.get(group.staff_index)!;
      const target: VisualNoteTarget = {
        musicXmlId: `page-${musicPageNumber}-${note.musicxml_id}`,
        pageIndex: page.index,
        visualGroupId: group.visual_group_id,
        staffIndex: group.staff_index,
        x: group.center[0],
        y: group.center[1],
        systemRight: system.right,
        systemTop: system.top,
        systemBottom: system.bottom,
      };
      result.set(target.musicXmlId, target);
      if (!result.has(note.musicxml_id)) result.set(note.musicxml_id, target);
    }
  }
  return result;
}

interface RepeatPair {
  start: number;
  end: number;
}

function repeatPairs(measures: StructuralMeasure[]): Map<number, RepeatPair> {
  const stack: number[] = [];
  const result = new Map<number, RepeatPair>();
  for (const measure of measures) {
    if (measure.forwardRepeat) stack.push(measure.index);
    if (measure.backwardRepeat) {
      const start = stack.pop() ?? 0;
      result.set(measure.index, { start, end: measure.index });
    }
  }
  return result;
}

function soundEligible(sound: NavigationSound, visit: number, fallbackVisit: number): boolean {
  return sound.timeOnly ? sound.timeOnly.has(visit) : visit === fallbackVisit;
}

function effectiveTempoBefore(score: RealtimeScore, measureIndex: number, localOffset: number): number {
  let bpm = 120;
  for (let index = 0; index <= measureIndex; index += 1) {
    for (const tempo of score.measures[index]?.tempos ?? []) {
      if (index < measureIndex || tempo.onset <= localOffset) bpm = tempo.bpm;
    }
  }
  return bpm;
}

function findSign(
  measures: StructuralMeasure[],
  kind: "segno" | "coda",
  token: string,
  afterIndex = -1,
): number {
  const candidates = measures.filter((measure) =>
    measure.index > afterIndex && measure.sounds.some((sound) => sound[kind] === token),
  );
  const fallback = candidates[0] ?? measures.find((measure) =>
    measure.sounds.some((sound) => Boolean(sound[kind])),
  );
  if (!fallback) throw new Error(`Realtime playback cannot find the ${kind} sign named “${token}”.`);
  return fallback.index;
}

interface ActiveRepeat extends RepeatPair {
  pass: number;
}

interface RouteScoreNote extends RealtimeScoreNote {
  onset: number;
  release: number;
  occurrenceId: string;
}

interface TremoloGroup {
  onset: number;
  release: number;
  notes: RouteScoreNote[];
  tremolo: RealtimeTremolo | null;
}

const DEFAULT_UNMEASURED_TREMOLO_QUARTERS = 0.125;
const MIN_TREMOLO_INTERVAL_QUARTERS = 1 / 32;
const DEFAULT_TRILL_INTERVAL_QUARTERS = 0.125;

function tremoloInterval(tremolo: RealtimeTremolo): number {
  if (tremolo.type === "unmeasured" || tremolo.marks === 0) {
    return DEFAULT_UNMEASURED_TREMOLO_QUARTERS;
  }
  return Math.max(
    MIN_TREMOLO_INTERVAL_QUARTERS,
    1 / (2 ** Math.min(8, tremolo.marks + tremolo.beamCount)),
  );
}

function performanceNote(
  note: RouteScoreNote,
  onset: number,
  release: number,
  index: number,
  visualMap?: ReadonlyMap<string, VisualNoteTarget>,
  pitch = note.pitch,
  fingeringMusicXmlId?: string | null,
): PerformanceNote {
  return {
    id: `${note.occurrenceId}:${note.musicXmlId}:${index}`,
    musicXmlId: note.musicXmlId,
    pitch,
    onset,
    release,
    visual: visualMap?.get(note.musicXmlId) ?? null,
    fingeringMusicXmlId,
  };
}

function expandOrnamentNotes(
  notes: RouteScoreNote[],
  visualMap?: ReadonlyMap<string, VisualNoteTarget>,
): PerformanceNote[] {
  const lanes = new Map<string, TremoloGroup[]>();
  for (const note of notes) {
    const laneKey = `${note.partId}:${note.staff}:${note.voice}`;
    const groups = lanes.get(laneKey) ?? [];
    const group = groups.at(-1);
    if (group?.onset === note.onset) {
      group.notes.push(note);
      group.release = Math.max(group.release, note.release);
      group.tremolo ??= note.tremolo;
    } else {
      groups.push({
        onset: note.onset,
        release: note.release,
        notes: [note],
        tremolo: note.tremolo,
      });
    }
    lanes.set(laneKey, groups);
  }

  const result: PerformanceNote[] = [];
  const addNote = (
    note: RouteScoreNote,
    onset: number,
    release: number,
    pitch = note.pitch,
  ) => {
    result.push(performanceNote(
      note,
      onset,
      release,
      result.length,
      visualMap,
      pitch,
      pitch === note.pitch ? undefined : null,
    ));
  };
  const addSingleTremolo = (group: TremoloGroup, tremolo: RealtimeTremolo) => {
    const interval = tremoloInterval(tremolo);
    const pulseCount = Math.min(
      4096,
      Math.max(1, Math.ceil((group.release - group.onset) / interval - 1e-9)),
    );
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const onset = group.onset + pulse * interval;
      for (const note of group.notes) {
        if (onset >= note.release - 1e-9) continue;
        addNote(note, onset, Math.min(note.release, onset + interval));
      }
    }
  };
  const addDoubleTremolo = (start: TremoloGroup, stop: TremoloGroup) => {
    const startTremolo = start.tremolo!;
    const stopTremolo = stop.tremolo!;
    const interval = Math.min(tremoloInterval(startTremolo), tremoloInterval(stopTremolo));
    const end = Math.max(stop.release, stop.onset);
    const pulseCount = Math.min(
      4096,
      Math.max(2, Math.ceil((end - start.onset) / interval - 1e-9)),
    );
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const onset = start.onset + pulse * interval;
      if (onset >= end - 1e-9) break;
      const source = pulse % 2 === 0 ? start : stop;
      for (const note of source.notes) addNote(note, onset, Math.min(end, onset + interval));
    }
  };
  const addTrill = (note: RouteScoreNote, trill: RealtimeTrill) => {
    const duration = Math.max(0, note.release - note.onset);
    const pulseCount = trill.beats ?? Math.min(
      4096,
      Math.max(2, Math.ceil(duration / DEFAULT_TRILL_INTERVAL_QUARTERS - 1e-9)),
    );
    const progressAt = (pulse: number) => {
      const progress = Math.min(1, Math.max(0, pulse / pulseCount));
      return trill.accelerate ? 1 - ((1 - progress) ** 1.8) : progress;
    };
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const onset = note.onset + duration * progressAt(pulse);
      const release = note.onset + duration * progressAt(pulse + 1);
      let pitch: string;
      if (trill.startNote === "below" && pulse === 0) {
        pitch = trill.lowerPitch;
      } else {
        const phase = trill.startNote === "below" ? pulse - 1 : pulse;
        const upper = trill.startNote === "upper" ? phase % 2 === 0 : phase % 2 === 1;
        pitch = upper ? trill.auxiliaryPitch : note.pitch;
      }
      addNote(note, onset, release, pitch);
    }
  };

  for (const groups of lanes.values()) {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const tremolo = group.tremolo;
      if (tremolo?.type === "single" || tremolo?.type === "unmeasured") {
        addSingleTremolo(group, tremolo);
        continue;
      }
      const stop = groups[index + 1];
      if (
        tremolo?.type === "start" &&
        stop?.tremolo?.type === "stop"
      ) {
        addDoubleTremolo(group, stop);
        index += 1;
        continue;
      }
      for (const note of group.notes) {
        if (note.trill) addTrill(note, note.trill);
        else addNote(note, note.onset, note.release);
      }
    }
  }
  return result.sort((left, right) =>
    left.onset - right.onset || left.release - right.release || left.id.localeCompare(right.id),
  );
}

export function expandPerformanceRoute(
  score: RealtimeScore,
  options: ExpandRouteOptions = {},
): PerformanceRoute {
  if (score.measures.length === 0) {
    return {
      occurrences: [],
      notes: [],
      playheadNotes: [],
      events: [],
      tempoSegments: [{ offset: 0, bpm: 120 }],
      totalQuarters: 0,
    };
  }
  const startMeasure = Math.min(
    score.measures.length - 1,
    Math.max(0, options.startMeasureIndex ?? 0),
  );
  const startOffset = Math.max(0, options.startOffset ?? 0);
  const maxVisits = options.maxMeasureVisits ?? 32;
  const maxOccurrences = options.maxOccurrences ?? 10_000;
  const pairs = repeatPairs(score.measures);
  const pairByStart = new Map<number, RepeatPair>();
  for (const pair of pairs.values()) pairByStart.set(pair.start, pair);
  const visits = new Map<number, number>();
  const activeRepeats: ActiveRepeat[] = [];
  const usedJumps = new Set<string>();
  const occurrences: PerformanceOccurrence[] = [];
  const rawNotes: RouteScoreNote[] = [];
  const rawTempos: TempoSegment[] = [{ offset: 0, bpm: effectiveTempoBefore(score, startMeasure, startOffset) }];
  let index = startMeasure;
  let scoreOffset = 0;
  let jumped = false;
  let firstOccurrence = true;
  let carriedEndingPass: number | null = score.measures[startMeasure].endingNumbers.size > 0
    ? Math.min(...score.measures[startMeasure].endingNumbers)
    : null;

  while (index >= 0 && index < score.measures.length) {
    if (occurrences.length >= maxOccurrences) {
      throw new Error(`Realtime navigation exceeded ${maxOccurrences} measures. Check repeat and jump marks.`);
    }
    const visit = (visits.get(index) ?? 0) + 1;
    visits.set(index, visit);
    if (visit > maxVisits) {
      throw new Error(`Measure ${score.measures[index].number} was visited more than ${maxVisits} times. Check repeat and D.C./D.S. navigation.`);
    }
    const measure = score.measures[index];
    const localStart = firstOccurrence ? Math.min(startOffset, measure.duration) : 0;
    firstOccurrence = false;

    const pairStarting = pairByStart.get(index);
    if (pairStarting && !activeRepeats.some((repeat) => repeat.end === pairStarting.end)) {
      activeRepeats.push({ ...pairStarting, pass: 1 });
    }
    const pairEnding = pairs.get(index);
    if (pairEnding && !activeRepeats.some((repeat) => repeat.end === index)) {
      activeRepeats.push({ ...pairEnding, start: Math.max(startMeasure, pairEnding.start), pass: 1 });
    }
    const repeat = [...activeRepeats].reverse().find((candidate) =>
      index >= candidate.start && index <= candidate.end,
    );
    if (!repeat && measure.endingNumbers.size === 0) carriedEndingPass = null;
    const pass = repeat?.pass ?? carriedEndingPass ?? 1;
    const include = measure.endingNumbers.size === 0 || measure.endingNumbers.has(pass);

    if (include) {
      const duration = Math.max(0, measure.duration - localStart);
      const occurrence: PerformanceOccurrence = {
        id: `occurrence-${occurrences.length}-measure-${index}`,
        routeIndex: occurrences.length,
        measureIndex: index,
        measureNumber: measure.number,
        pageNumber: measure.pageNumber,
        pass,
        scoreStart: scoreOffset,
        scoreEnd: scoreOffset + duration,
        localStart,
      };
      occurrences.push(occurrence);
      for (const note of measure.notes) {
        if (note.onset + note.duration <= localStart || note.onset < localStart) continue;
        rawNotes.push({
          ...note,
          onset: scoreOffset + note.onset - localStart,
          release: scoreOffset + note.onset + note.duration - localStart,
          occurrenceId: occurrence.id,
        });
      }
      for (const tempo of measure.tempos) {
        if (tempo.onset >= localStart) {
          rawTempos.push({ offset: scoreOffset + tempo.onset - localStart, bpm: tempo.bpm });
        }
      }
      scoreOffset += duration;
    }

    let navigationTarget: number | null = null;
    if (include) {
      const soundTime = repeat?.pass ?? visit;
      for (const sound of measure.sounds) {
        if (sound.fine && jumped && soundEligible(sound, soundTime, soundTime)) {
          navigationTarget = score.measures.length;
          break;
        }
        if (sound.tocoda && jumped && soundEligible(sound, soundTime, 2)) {
          navigationTarget = findSign(score.measures, "coda", sound.tocoda, index);
          break;
        }
        if (sound.dacapo && !usedJumps.has(sound.id) && soundEligible(sound, soundTime, 1)) {
          usedJumps.add(sound.id);
          jumped = true;
          activeRepeats.length = 0;
          navigationTarget = 0;
          break;
        }
        if (sound.dalsegno && !usedJumps.has(sound.id) && soundEligible(sound, soundTime, 1)) {
          usedJumps.add(sound.id);
          jumped = true;
          activeRepeats.length = 0;
          navigationTarget = findSign(score.measures, "segno", sound.dalsegno);
          break;
        }
      }
    }
    if (navigationTarget !== null) {
      index = navigationTarget;
      continue;
    }

    if (pairEnding) {
      const active = activeRepeats.find((candidate) => candidate.end === index);
      const repeatAllowedAfterJump = !jumped || measure.endingNumbers.size > 0 || measure.backwardRepeat?.afterJump;
      if (include && active && repeatAllowedAfterJump && active.pass < (measure.backwardRepeat?.times ?? 2)) {
        active.pass += 1;
        index = active.start;
        continue;
      }
      if (active) activeRepeats.splice(activeRepeats.indexOf(active), 1);
      if (active) carriedEndingPass = active.pass;
    }
    index += 1;
  }

  const sustainedNotes: RouteScoreNote[] = [];
  const activeTies = new Map<string, RouteScoreNote>();
  for (const note of rawNotes.sort((left, right) => left.onset - right.onset || left.release - right.release)) {
    const tieOwner = note.inferredTieGroup ?? `voice:${note.voice}`;
    const tieKey = `${note.partId}:${note.staff}:${tieOwner}:${note.pitch}`;
    const tied = note.tieStop ? activeTies.get(tieKey) : undefined;
    if (tied) {
      tied.release = Math.max(tied.release, note.release);
      if (!note.tieStart) activeTies.delete(tieKey);
      continue;
    }
    sustainedNotes.push(note);
    if (note.tieStart) activeTies.set(tieKey, note);
  }
  const playheadNotes = sustainedNotes.map((note, index) =>
    performanceNote(note, note.onset, note.release, index, options.visualMap),
  );
  const performanceNotes = expandOrnamentNotes(sustainedNotes, options.visualMap);

  const sortedTempos = rawTempos
    .sort((left, right) => left.offset - right.offset)
    .filter((tempo, index, all) =>
      index === all.length - 1 || all[index + 1].offset !== tempo.offset,
    )
    .filter((tempo, index, all) => index === 0 || tempo.bpm !== all[index - 1].bpm);
  const eventsByOnset = new Map<number, PerformanceEvent>();
  for (const note of performanceNotes) {
    const event = eventsByOnset.get(note.onset);
    if (event) {
      event.notes.push(note);
      if (!event.pitches.includes(note.pitch)) event.pitches.push(note.pitch);
    } else {
      eventsByOnset.set(note.onset, {
        onset: note.onset,
        notes: [note],
        pitches: [note.pitch],
      });
    }
  }
  const performanceEvents = [...eventsByOnset.values()]
    .sort((left, right) => left.onset - right.onset);
  return {
    occurrences,
    notes: performanceNotes,
    playheadNotes,
    events: performanceEvents,
    tempoSegments: sortedTempos,
    totalQuarters: scoreOffset,
  };
}

export function structuralPositionForGroup(
  score: RealtimeScore,
  visualMap: ReadonlyMap<string, VisualNoteTarget>,
  group: VisualGroupRef | null,
): StructuralPosition | null {
  if (!group) return null;
  for (const measure of score.measures) {
    const matching = measure.notes
      .filter((note) => {
        const visual = visualMap.get(note.musicXmlId);
        return visual?.pageIndex === group.pageIndex && visual.visualGroupId === group.visualGroupId;
      })
      .sort((left, right) => left.onset - right.onset);
    if (matching[0]) return { measureIndex: measure.index, onset: matching[0].onset };
  }
  return null;
}

function playableStructuralPositions(score: RealtimeScore): StructuralPosition[] {
  return score.measures.flatMap((measure) =>
    Array.from(new Set(measure.notes.map((note) => note.onset)))
      .sort((left, right) => left - right)
      .map((onset) => ({ measureIndex: measure.index, onset })),
  );
}

export function seekStructuralPosition(
  score: RealtimeScore,
  current: StructuralPosition,
  command: StructuralSeekCommand,
): StructuralPosition {
  const positions = playableStructuralPositions(score);
  if (positions.length === 0) return { measureIndex: 0, onset: 0 };
  let currentIndex = positions.findIndex((position) =>
    position.measureIndex > current.measureIndex ||
    (position.measureIndex === current.measureIndex && position.onset >= current.onset - 1e-6),
  );
  if (currentIndex < 0) currentIndex = positions.length - 1;
  if (command === "forwardNote") return positions[Math.min(positions.length - 1, currentIndex + 1)];
  if (command === "backwardNote") return positions[Math.max(0, currentIndex - 1)];

  const currentMeasure = positions[currentIndex].measureIndex;
  if (command === "forwardBar" || command === "backwardBar") {
    const direction = command === "forwardBar" ? 1 : -1;
    let measureIndex = currentMeasure + direction;
    while (measureIndex >= 0 && measureIndex < score.measures.length) {
      const destination = positions.find((position) => position.measureIndex === measureIndex);
      if (destination) return destination;
      measureIndex += direction;
    }
    return direction > 0 ? positions.at(-1)! : positions[0];
  }

  const currentPage = score.measures[currentMeasure]?.pageNumber ?? 1;
  if (command === "forwardPage") {
    return positions.find((position) =>
      (score.measures[position.measureIndex]?.pageNumber ?? currentPage) > currentPage,
    ) ?? positions.at(-1)!;
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const page = score.measures[positions[index].measureIndex]?.pageNumber ?? currentPage;
    if (page < currentPage) {
      const targetPage = page;
      return positions.find((position) =>
        (score.measures[position.measureIndex]?.pageNumber ?? targetPage) === targetPage,
      ) ?? positions[index];
    }
  }
  return positions[0];
}

interface RouteTimingIndex {
  offsets: number[];
  bpms: number[];
  cumulativeSeconds: number[];
  totalSeconds: number;
}

const routeTimingCache = new WeakMap<PerformanceRoute, RouteTimingIndex>();

function routeTiming(route: PerformanceRoute): RouteTimingIndex {
  const cached = routeTimingCache.get(route);
  if (cached) return cached;
  const source = route.tempoSegments
    .filter((segment) => segment.offset >= 0 && segment.offset <= route.totalQuarters)
    .sort((left, right) => left.offset - right.offset);
  const segments = source[0]?.offset === 0
    ? source
    : [{ offset: 0, bpm: source[0]?.bpm ?? 120 }, ...source];
  const offsets: number[] = [];
  const bpms: number[] = [];
  const cumulativeSeconds: number[] = [];
  for (const segment of segments) {
    if (offsets.at(-1) === segment.offset) {
      bpms[bpms.length - 1] = segment.bpm;
      continue;
    }
    const previousIndex = offsets.length - 1;
    const elapsed = previousIndex < 0
      ? 0
      : cumulativeSeconds[previousIndex] +
        (segment.offset - offsets[previousIndex]) * 60 / bpms[previousIndex];
    offsets.push(segment.offset);
    bpms.push(segment.bpm);
    cumulativeSeconds.push(elapsed);
  }
  const last = offsets.length - 1;
  const index = {
    offsets,
    bpms,
    cumulativeSeconds,
    totalSeconds: cumulativeSeconds[last] +
      (route.totalQuarters - offsets[last]) * 60 / bpms[last],
  };
  routeTimingCache.set(route, index);
  return index;
}

function timingSegmentAtOffset(index: RouteTimingIndex, offset: number): number {
  let low = 0;
  let high = index.offsets.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (index.offsets[middle] <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function tempoAt(route: PerformanceRoute, offset: number): number {
  const timing = routeTiming(route);
  return timing.bpms[timingSegmentAtOffset(timing, offset)] ?? 120;
}

export function scoreOffsetToSeconds(
  route: PerformanceRoute,
  offset: number,
  multiplier = 1,
): number {
  const end = Math.min(route.totalQuarters, Math.max(0, offset));
  const timing = routeTiming(route);
  const segment = timingSegmentAtOffset(timing, end);
  const baseSeconds = timing.cumulativeSeconds[segment] +
    (end - timing.offsets[segment]) * 60 / timing.bpms[segment];
  return baseSeconds / (multiplier > 0 ? multiplier : 1);
}

export function scoreOffsetAfterSeconds(
  route: PerformanceRoute,
  startOffset: number,
  seconds: number,
  multiplier = 1,
): number {
  if (seconds <= 0) return startOffset;
  const timing = routeTiming(route);
  const speed = multiplier > 0 ? multiplier : 1;
  const target = scoreOffsetToSeconds(route, startOffset, 1) + seconds * speed;
  if (target >= timing.totalSeconds) return route.totalQuarters;
  let low = 0;
  let high = timing.cumulativeSeconds.length - 1;
  let segment = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timing.cumulativeSeconds[middle] <= target) {
      segment = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return timing.offsets[segment] +
    (target - timing.cumulativeSeconds[segment]) * timing.bpms[segment] / 60;
}

function bbox(group: VisualGroup): VisualBBox {
  if (group.bbox.length === 4) return group.bbox as VisualBBox;
  return [group.center[0] - 8, group.center[1] - 8, group.center[0] + 8, group.center[1] + 8];
}

const playheadNotesCache = new WeakMap<PerformanceRoute, PerformanceNote[]>();

function visibleRouteNotes(route: PerformanceRoute): PerformanceNote[] {
  const cached = playheadNotesCache.get(route);
  if (cached) return cached;
  const visible = (route.playheadNotes ?? route.notes).filter((note) => note.visual !== null);
  playheadNotesCache.set(route, visible);
  return visible;
}

function occurrenceEndAt(route: PerformanceRoute, offset: number): number | null {
  let low = 0;
  let high = route.occurrences.length - 1;
  let candidate: PerformanceOccurrence | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const occurrence = route.occurrences[middle];
    if (occurrence.scoreStart <= offset) {
      candidate = occurrence;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate?.scoreEnd ?? null;
}

export function realtimePlayheadAt(
  route: PerformanceRoute,
  offset: number,
  _pages: DocumentPage[],
): RealtimePlayhead | null {
  const visible = visibleRouteNotes(route);
  if (visible.length === 0) return null;
  let low = 0;
  let high = visible.length - 1;
  let currentIndex = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (visible[middle].onset <= offset) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  while (currentIndex > 0 && visible[currentIndex - 1].onset === visible[currentIndex].onset) {
    currentIndex -= 1;
  }
  const current = visible[currentIndex];
  const visual = current.visual!;
  let nextIndex = currentIndex + 1;
  while (nextIndex < visible.length && visible[nextIndex].onset <= current.onset) nextIndex += 1;
  const next = visible[nextIndex];
  let destinationX = visual.systemRight;
  let destinationOffset = occurrenceEndAt(route, current.onset) ?? current.release;
  if (
    next?.visual?.pageIndex === visual.pageIndex &&
    next.visual.staffIndex === visual.staffIndex
  ) {
    destinationX = next.visual.x;
    destinationOffset = next.onset;
  } else if (next) {
    destinationOffset = next.onset;
  }
  const progress = destinationOffset <= current.onset
    ? 0
    : Math.min(1, Math.max(0, (offset - current.onset) / (destinationOffset - current.onset)));
  return {
    pageIndex: visual.pageIndex,
    staffIndex: visual.staffIndex,
    x: visual.x + (destinationX - visual.x) * progress,
    y1: visual.systemTop,
    y2: visual.systemBottom,
  };
}

export interface RealtimeAudioSink {
  attack(pitches: readonly string[]): void;
  release(pitches: readonly string[]): void;
  stop(): void;
}

export interface RealtimeClock {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const browserClock: RealtimeClock = {
  now: () => performance.now() / 1000,
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RealtimeControllerCallbacks {
  onFrame(frame: Omit<RealtimeFrame, "playhead">): void;
  onComplete(): void;
}

export class RealtimeController {
  private route: PerformanceRoute | null = null;
  private status: "inactive" | "playing" | "paused" = "inactive";
  private offset = 0;
  private anchorOffset = 0;
  private anchorTime = 0;
  private tempoMultiplier = 1;
  private muted = false;
  private timer: unknown = null;
  private soundingNotes = new Map<string, string>();
  private activeTimelineNotes = new Map<string, PerformanceNote>();
  private noteCursor = 0;
  private evaluatedOffset = -1;

  constructor(
    private readonly sink: RealtimeAudioSink,
    private readonly callbacks: RealtimeControllerCallbacks,
    private readonly clock: RealtimeClock = browserClock,
    private readonly intervalMs = 16,
  ) {}

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  private currentOffset(): number {
    if (!this.route || this.status !== "playing") return this.offset;
    return scoreOffsetAfterSeconds(
      this.route,
      this.anchorOffset,
      Math.max(0, this.clock.now() - this.anchorTime),
      this.tempoMultiplier,
    );
  }

  private silence(): void {
    this.soundingNotes.clear();
    this.sink.stop();
  }

  private resetActiveNotes(offset: number): void {
    this.activeTimelineNotes.clear();
    this.noteCursor = 0;
    if (!this.route) return;
    while (
      this.noteCursor < this.route.notes.length &&
      this.route.notes[this.noteCursor].onset <= offset + 1e-6
    ) {
      const note = this.route.notes[this.noteCursor];
      if (note.release > offset + 1e-6) this.activeTimelineNotes.set(note.id, note);
      this.noteCursor += 1;
    }
    this.evaluatedOffset = offset;
  }

  private activeNotesAt(offset: number): PerformanceNote[] {
    if (!this.route) return [];
    if (offset + 1e-6 < this.evaluatedOffset) this.resetActiveNotes(offset);
    for (const [id, note] of this.activeTimelineNotes) {
      if (note.release <= offset + 1e-6) this.activeTimelineNotes.delete(id);
    }
    while (
      this.noteCursor < this.route.notes.length &&
      this.route.notes[this.noteCursor].onset <= offset + 1e-6
    ) {
      const note = this.route.notes[this.noteCursor];
      if (note.release > offset + 1e-6) this.activeTimelineNotes.set(note.id, note);
      this.noteCursor += 1;
    }
    this.evaluatedOffset = offset;
    return [...this.activeTimelineNotes.values()];
  }

  private publish(): void {
    if (!this.route || this.status === "inactive") return;
    this.offset = this.currentOffset();
    if (this.offset >= this.route.totalQuarters && this.status === "playing") {
      this.offset = this.route.totalQuarters;
      this.clearTimer();
      this.status = "inactive";
      this.silence();
      this.callbacks.onComplete();
      return;
    }
    const activeNotes = this.activeNotesAt(this.offset);
    const desiredByPitch = new Map<string, Set<string>>();
    for (const note of activeNotes) {
      const ids = desiredByPitch.get(note.pitch) ?? new Set<string>();
      ids.add(note.id);
      desiredByPitch.set(note.pitch, ids);
    }
    if (!this.muted && this.status === "playing") {
      const currentByPitch = new Map<string, Set<string>>();
      for (const [id, pitch] of this.soundingNotes) {
        const ids = currentByPitch.get(pitch) ?? new Set<string>();
        ids.add(id);
        currentByPitch.set(pitch, ids);
      }
      const releases: string[] = [];
      const attacks: string[] = [];
      for (const [pitch, currentIds] of currentByPitch) {
        const desiredIds = desiredByPitch.get(pitch);
        if (!desiredIds || ![...currentIds].some((id) => desiredIds.has(id))) releases.push(pitch);
      }
      for (const [pitch, desiredIds] of desiredByPitch) {
        const currentIds = currentByPitch.get(pitch);
        if (!currentIds || ![...desiredIds].some((id) => currentIds.has(id))) attacks.push(pitch);
      }
      if (releases.length > 0) this.sink.release(releases);
      if (attacks.length > 0) this.sink.attack(attacks);
      this.soundingNotes = new Map(activeNotes.map((note) => [note.id, note.pitch]));
    } else if (this.soundingNotes.size > 0) {
      this.silence();
    }
    this.callbacks.onFrame({
      status: this.status,
      offset: this.offset,
      bpm: tempoAt(this.route, this.offset) * this.tempoMultiplier,
      activeNotes,
    });
  }

  play(route: PerformanceRoute, offset = 0): void {
    this.clearTimer();
    this.silence();
    this.route = route;
    this.status = "playing";
    this.offset = Math.min(route.totalQuarters, Math.max(0, offset));
    this.anchorOffset = this.offset;
    this.anchorTime = this.clock.now();
    this.resetActiveNotes(this.offset);
    this.publish();
    if (this.status === "playing") {
      this.timer = this.clock.setInterval(() => this.publish(), this.intervalMs);
    }
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.offset = this.currentOffset();
    this.status = "paused";
    this.clearTimer();
    this.silence();
    this.publish();
  }

  resume(): void {
    if (!this.route || this.status !== "paused") return;
    this.status = "playing";
    this.anchorOffset = this.offset;
    this.anchorTime = this.clock.now();
    this.publish();
    this.timer = this.clock.setInterval(() => this.publish(), this.intervalMs);
  }

  seek(route: PerformanceRoute, keepStatus: "playing" | "paused"): void {
    if (keepStatus === "playing") {
      this.play(route, 0);
      return;
    }
    this.clearTimer();
    this.silence();
    this.route = route;
    this.status = "paused";
    this.offset = 0;
    this.anchorOffset = 0;
    this.anchorTime = this.clock.now();
    this.resetActiveNotes(0);
    this.publish();
  }

  stop(): void {
    this.clearTimer();
    this.status = "inactive";
    this.offset = 0;
    this.route = null;
    this.activeTimelineNotes.clear();
    this.noteCursor = 0;
    this.evaluatedOffset = -1;
    this.silence();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.publish();
  }

  setTempoMultiplier(multiplier: number): void {
    const normalized = Math.min(3, Math.max(0.1, multiplier));
    if (normalized === this.tempoMultiplier) return;
    const current = this.currentOffset();
    this.tempoMultiplier = normalized;
    this.offset = current;
    this.anchorOffset = current;
    this.anchorTime = this.clock.now();
    this.publish();
  }

  getOffset(): number {
    return this.currentOffset();
  }
}
