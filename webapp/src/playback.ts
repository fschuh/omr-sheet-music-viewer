import type { VisualGroupRef } from "./types";
import type { GeometryNote, NoteheadGeometry, PageNoteGeometry } from "./noteGeometry";
import type { PredictedFingering } from "./fingering";
import {
  scoreNoteStartsAttack,
  type RealtimeScore,
  type RealtimeScoreNote,
} from "./realtime";
import type { MusicalDynamic } from "./pianoRegistry";

export const playbackCommandNames = [
  "togglePlayback",
  "stopPlayback",
  "toggleNoteSounds",
  "toggleListenMode",
  "playCurrentNotes",
  "forwardNote",
  "backwardNote",
  "forwardBar",
  "backwardBar",
  "forwardPage",
  "backwardPage",
  "toggleLoopMode",
] as const;

export type PlaybackCommand = (typeof playbackCommandNames)[number];

export interface PlaybackMoment {
  id: string;
  pageIndex: number;
  staffGroupIndex: number;
  measure: number | null;
  /** The measure by its position in the document, from 0, as loops count measures. */
  measureIndex: number | null;
  barKey: string;
  visualGroupIds: string[];
  pitches: string[];
  dynamic: MusicalDynamic;
  keyboardNotes: PlaybackKeyboardNote[];
  center: [number, number];
  /** Every note at this moment with its hand, so the moment can be narrowed to one hand. */
  notes?: PlaybackMomentNote[];
}

export interface PlaybackKeyboardNote {
  pitch: string;
  finger?: number;
  /** Left hand; absent when the hand is unknown. */
  left?: boolean;
}

export interface PlaybackMomentNote {
  pitch: string;
  /** Left hand, by the staff/clef rule fingering uses; absent when the score could not be read. */
  left?: boolean;
  startsAttack: boolean;
  visualGroupId: string;
}

/** The hand being practised; "both" is ordinary playback. */
export type PracticeHand = "both" | "left" | "right";

/** Notes of unknown hand are never hidden, so a score without hand data still plays. */
export function noteInPracticeHand(left: boolean | undefined, hand: PracticeHand): boolean {
  return hand === "both" || left === undefined || left === (hand === "left");
}

/** A moment stays in a one-hand timeline only when that hand plays something new there. */
export function momentHasPracticeHandAttack(
  moment: { notes?: readonly Pick<PlaybackMomentNote, "left" | "startsAttack">[] },
  hand: PracticeHand,
): boolean {
  if (hand === "both" || !moment.notes) return true;
  return moment.notes.some((note) => note.startsAttack && noteInPracticeHand(note.left, hand));
}

/**
 * The timeline narrowed to one hand: moments where that hand plays nothing new
 * are skipped, and the rest keep only that hand's notes, noteheads and keys.
 * Moment ids are unchanged, so a moment can be looked up in either timeline.
 */
export function timelineForPracticeHand(
  timeline: PlaybackMoment[],
  hand: PracticeHand,
): PlaybackMoment[] {
  if (hand === "both") return timeline;
  return timeline.flatMap((moment) => {
    if (!moment.notes) return [moment];
    if (!momentHasPracticeHandAttack(moment, hand)) return [];
    const notes = moment.notes.filter((note) => noteInPracticeHand(note.left, hand));
    const groupIds = new Set(notes.map((note) => note.visualGroupId));
    return [{
      ...moment,
      notes,
      visualGroupIds: moment.visualGroupIds.filter((id) => groupIds.has(id)),
      pitches: Array.from(new Set(
        notes.filter((note) => note.startsAttack).map((note) => note.pitch),
      )),
      keyboardNotes: moment.keyboardNotes.filter((note) => noteInPracticeHand(note.left, hand)),
    }];
  });
}

/**
 * The practice-timeline moment to stand on for a moment of the full timeline:
 * itself when kept, otherwise the next kept moment, or the last one before it.
 */
export function snapMomentToTimeline(
  fullTimeline: readonly PlaybackMoment[],
  timeline: readonly PlaybackMoment[],
  momentId: string,
): string | null {
  const kept = new Set(timeline.map((moment) => moment.id));
  if (kept.has(momentId)) return momentId;
  const index = fullTimeline.findIndex((moment) => moment.id === momentId);
  if (index < 0) return timeline[0]?.id ?? null;
  const after = fullTimeline.slice(index + 1).find((moment) => kept.has(moment.id));
  if (after) return after.id;
  return fullTimeline.slice(0, index).reverse().find((moment) => kept.has(moment.id))?.id ?? null;
}

const NO_PLAYBACK_GROUPS: readonly string[] = [];

export function playbackGroupIdsForPage(
  moment: PlaybackMoment | null,
  pageIndex: number,
): readonly string[] {
  return moment?.pageIndex === pageIndex ? moment.visualGroupIds : NO_PLAYBACK_GROUPS;
}

export function playbackGroupIdsByPageForAnchors(
  timeline: PlaybackMoment[],
  anchors: readonly VisualGroupRef[],
): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  for (const anchor of anchors) {
    const moment = timeline.find(
      (candidate) =>
        candidate.pageIndex === anchor.pageIndex &&
        candidate.visualGroupIds.includes(anchor.visualGroupId),
    );
    const ids = moment?.visualGroupIds ?? [anchor.visualGroupId];
    const pageIds = result[anchor.pageIndex] ?? [];
    for (const id of ids) {
      if (!pageIds.includes(id)) pageIds.push(id);
    }
    result[anchor.pageIndex] = pageIds;
  }
  return result;
}

export interface PlaybackState {
  active: boolean;
  currentMomentId: string | null;
  noteSoundsEnabled: boolean;
  listenModeEnabled: boolean;
}

export const initialPlaybackState: PlaybackState = {
  active: false,
  currentMomentId: null,
  noteSoundsEnabled: true,
  listenModeEnabled: false,
};

export function effectivePlaybackNoteSounds(state: PlaybackState): boolean {
  return state.active && state.noteSoundsEnabled && !state.listenModeEnabled;
}

interface TimelineGroup {
  notehead: NoteheadGeometry;
  x: number;
  measures: Set<number>;
  notes: GeometryNote[];
}

interface MomentCluster {
  groups: TimelineGroup[];
  x: number;
  measure: number | null;
  canonicalMomentId?: string;
}

interface PlaybackPitchNote {
  musicXmlId: string;
  pitch: string;
  startsAttack: boolean;
  dynamic: MusicalDynamic;
  left?: boolean;
  visualGroupId: string;
}

function notesByNotehead(
  notes: readonly GeometryNote[],
  suppressed: (note: GeometryNote) => boolean,
): Map<string, GeometryNote[]> {
  const result = new Map<string, GeometryNote[]>();
  for (const note of notes) {
    if (suppressed(note) || note.pitch === null) continue;
    const linked = result.get(note.noteheadId) ?? [];
    linked.push(note);
    result.set(note.noteheadId, linked);
  }
  return result;
}

function mostCommonMeasure(groups: TimelineGroup[]): number | null {
  const counts = new Map<number, number>();
  for (const entry of groups) {
    for (const measure of entry.measures) counts.set(measure, (counts.get(measure) ?? 0) + 1);
  }
  let result: number | null = null;
  let highestCount = 0;
  for (const [measure, count] of counts) {
    if (count > highestCount || (count === highestCount && (result === null || measure < result))) {
      result = measure;
      highestCount = count;
    }
  }
  return result;
}

function clustersByMomentIdForSystem(
  noteheads: readonly NoteheadGeometry[],
  notes: readonly GeometryNote[],
  suppressed: (note: GeometryNote) => boolean,
): MomentCluster[] {
  const linkedNotes = notesByNotehead(notes, suppressed);
  const byMoment = new Map<string, TimelineGroup[]>();
  for (const notehead of noteheads) {
    if (notehead.momentId === null) continue;
    const noteheadNotes = linkedNotes.get(notehead.id) ?? [];
    const entry: TimelineGroup = {
      notehead,
      x: (notehead.noteheadBounds[0] + notehead.noteheadBounds[2]) / 2,
      measures: new Set(noteheadNotes.map((note) => note.measure)),
      notes: noteheadNotes,
    };
    const entries = byMoment.get(notehead.momentId) ?? [];
    entries.push(entry);
    byMoment.set(notehead.momentId, entries);
  }
  return [...byMoment.entries()]
    .map(([momentId, entries]) => ({
      groups: entries,
      x: entries.reduce((total, entry) => total + entry.x, 0) / entries.length,
      measure: mostCommonMeasure(entries),
      canonicalMomentId: momentId,
    }))
    .sort(
      (first, second) =>
        first.x - second.x ||
        (first.canonicalMomentId ?? "").localeCompare(second.canonicalMomentId ?? ""),
    );
}

/** What the score says about each note, keyed by viewer note ID. */
export interface NoteScoreFacts {
  /** Notes that start no sound of their own, such as tied continuations. */
  suppressedNoteIds: Set<string>;
  startsAttackByNoteId: Map<string, boolean>;
  dynamicByNoteId: Map<string, MusicalDynamic>;
  leftByNoteId: Map<string, boolean>;
}

export function emptyNoteScoreFacts(): NoteScoreFacts {
  return {
    suppressedNoteIds: new Set(),
    startsAttackByNoteId: new Map(),
    dynamicByNoteId: new Map(),
    leftByNoteId: new Map(),
  };
}

/** Facts for every non-grace note of `score`, keyed by `idPrefix` and the note's ID. */
export function noteScoreFacts(score: RealtimeScore, idPrefix = ""): NoteScoreFacts {
  const facts = emptyNoteScoreFacts();
  for (const measure of score.measures) {
    for (const event of measure.events) {
      const eventNotes = event.notes.filter((note) => !note.grace);
      const id = (note: RealtimeScoreNote) => `${idPrefix}${note.musicXmlId}`;
      for (const note of eventNotes) facts.leftByNoteId.set(id(note), note.left);
      if (eventNotes.some(scoreNoteStartsAttack)) {
        // Record attack status for every tone in a partial-tie event so the
        // chord on the page can distinguish held and newly attacked notes.
        for (const note of eventNotes) {
          facts.startsAttackByNoteId.set(id(note), scoreNoteStartsAttack(note));
          facts.dynamicByNoteId.set(id(note), note.dynamic);
        }
      } else {
        for (const note of eventNotes) {
          facts.suppressedNoteIds.add(id(note));
          facts.startsAttackByNoteId.set(id(note), false);
          facts.dynamicByNoteId.set(id(note), note.dynamic);
        }
      }
    }
  }
  return facts;
}

export function mergeNoteScoreFacts(all: readonly NoteScoreFacts[]): NoteScoreFacts {
  const merged = emptyNoteScoreFacts();
  for (const facts of all) {
    for (const id of facts.suppressedNoteIds) merged.suppressedNoteIds.add(id);
    for (const [id, value] of facts.startsAttackByNoteId) merged.startsAttackByNoteId.set(id, value);
    for (const [id, value] of facts.dynamicByNoteId) merged.dynamicByNoteId.set(id, value);
    for (const [id, value] of facts.leftByNoteId) merged.leftByNoteId.set(id, value);
  }
  return merged;
}

function playbackNotesForCluster(
  cluster: MomentCluster,
  scoreFacts: NoteScoreFacts,
): PlaybackPitchNote[] {
  const result: PlaybackPitchNote[] = [];
  const seenIds = new Set<string>();
  for (const entry of cluster.groups) {
    for (const note of entry.notes) {
      if (note.pitch === null || seenIds.has(note.id)) continue;
      seenIds.add(note.id);
      result.push({
        musicXmlId: note.id,
        pitch: note.pitch,
        startsAttack: scoreFacts.startsAttackByNoteId.get(note.id) ?? true,
        dynamic: scoreFacts.dynamicByNoteId.get(note.id) ?? "mp",
        left: scoreFacts.leftByNoteId.get(note.id),
        visualGroupId: entry.notehead.id,
      });
    }
  }
  return result;
}

export function buildPlaybackTimeline(
  geometry: readonly PageNoteGeometry[],
  scoreFacts: NoteScoreFacts = emptyNoteScoreFacts(),
  predictedFingerings: Readonly<Record<string, PredictedFingering>> = {},
): PlaybackMoment[] {
  const result: PlaybackMoment[] = [];
  // Grace notes are ornaments of the following note and never form a moment of their own.
  const suppressed = (note: GeometryNote) =>
    note.grace || scoreFacts.suppressedNoteIds.has(note.id);
  for (const page of [...geometry].sort((first, second) => first.pageIndex - second.pageIndex)) {
    // A notehead plays when one of its notes does.
    const playingNoteheadIds = new Set(
      page.notes.filter((note) => !suppressed(note)).map((note) => note.noteheadId),
    );
    const eligibleNoteheads = page.noteheads.filter((notehead) =>
      playingNoteheadIds.has(notehead.id),
    );
    const systemIndexes = Array.from(
      new Set(eligibleNoteheads.map((notehead) => notehead.systemIndex)),
    ).sort((first, second) => first - second);
    for (const systemIndex of systemIndexes) {
      const clusters = clustersByMomentIdForSystem(
        eligibleNoteheads.filter((notehead) => notehead.systemIndex === systemIndex),
        page.notes,
        suppressed,
      );
      clusters.forEach((cluster, clusterIndex) => {
        const momentNotes = playbackNotesForCluster(cluster, scoreFacts);
        const visualGroupIds = cluster.groups
          .map((entry) => entry.notehead.id)
          .sort((first, second) => first.localeCompare(second));
        const pitches = Array.from(
          new Set(
            momentNotes
              .filter((note) => note.startsAttack)
              .map((note) => note.pitch),
          ),
        );
        const keyboardNotes: PlaybackKeyboardNote[] = [];
        const seenKeyboardNotes = new Set<string>();
        for (const note of momentNotes) {
          const predicted = predictedFingerings[note.musicXmlId];
          // Fingering picks its hand by the same staff/clef rule, so the two agree.
          const left = predicted?.left ?? note.left;
          const key = `${note.pitch}:${left ?? ""}:${predicted?.finger ?? ""}`;
          if (seenKeyboardNotes.has(key)) continue;
          seenKeyboardNotes.add(key);
          keyboardNotes.push({
            pitch: note.pitch,
            ...(left === undefined ? {} : { left }),
            ...predicted,
          });
        }
        const centerY =
          cluster.groups.reduce((total, entry) => total + entry.notehead.center[1], 0) /
          cluster.groups.length;
        const pageIndex = page.pageIndex;
        const unknownBarKey = `page-${pageIndex}-staff-group-${systemIndex}-unknown`;
        result.push({
          id: cluster.canonicalMomentId
            ? `page-${pageIndex}-${cluster.canonicalMomentId}`
            : `page-${pageIndex}-staff-group-${systemIndex}-moment-${clusterIndex}-${visualGroupIds.join("+")}`,
          pageIndex,
          staffGroupIndex: systemIndex,
          measure: cluster.measure,
          measureIndex: cluster.measure === null ? null : page.measureOffset + cluster.measure - 1,
          barKey: cluster.measure === null ? unknownBarKey : `page-${pageIndex}-measure-${cluster.measure}`,
          visualGroupIds,
          pitches,
          dynamic: momentNotes.find((note) => note.startsAttack)?.dynamic ?? "mp",
          keyboardNotes,
          center: [cluster.x, centerY],
          notes: momentNotes.map(({ pitch, left, startsAttack, visualGroupId }) => ({
            pitch,
            ...(left === undefined ? {} : { left }),
            startsAttack,
            visualGroupId,
          })),
        });
      });
    }
  }
  return result;
}

export function currentPlaybackMoment(
  timeline: PlaybackMoment[],
  state: PlaybackState,
): PlaybackMoment | null {
  if (!state.active) return null;
  return timeline.find((moment) => moment.id === state.currentMomentId) ?? timeline[0] ?? null;
}

export function seekPlaybackToGroup(
  timeline: PlaybackMoment[],
  state: PlaybackState,
  selectedGroup: VisualGroupRef | null,
): PlaybackState {
  if (!state.active || !selectedGroup) return state;
  const moment = timeline.find(
    (candidate) =>
      candidate.pageIndex === selectedGroup.pageIndex &&
      candidate.visualGroupIds.includes(selectedGroup.visualGroupId),
  );
  if (!moment || moment.id === state.currentMomentId) return state;
  return { ...state, currentMomentId: moment.id };
}

/**
 * Seeks within a one-hand timeline. Selecting a notehead of the other hand, or
 * of a skipped moment, lands on the practised hand's next moment instead.
 */
export function seekPracticePlaybackToGroup(
  fullTimeline: PlaybackMoment[],
  timeline: PlaybackMoment[],
  state: PlaybackState,
  selectedGroup: VisualGroupRef | null,
): PlaybackState {
  const direct = seekPlaybackToGroup(timeline, state, selectedGroup);
  if (direct !== state || !state.active || !selectedGroup || fullTimeline === timeline) {
    return direct;
  }
  const moment = fullTimeline.find(
    (candidate) =>
      candidate.pageIndex === selectedGroup.pageIndex &&
      candidate.visualGroupIds.includes(selectedGroup.visualGroupId),
  );
  if (!moment) return state;
  const momentId = snapMomentToTimeline(fullTimeline, timeline, moment.id);
  return momentId && momentId !== state.currentMomentId
    ? { ...state, currentMomentId: momentId }
    : state;
}

function currentIndex(timeline: PlaybackMoment[], state: PlaybackState): number {
  const index = timeline.findIndex((moment) => moment.id === state.currentMomentId);
  return index < 0 ? 0 : index;
}

function firstMomentOfPreviousBar(timeline: PlaybackMoment[], index: number): number {
  const currentBar = timeline[index].barKey;
  let target = index - 1;
  while (target >= 0 && timeline[target].barKey === currentBar) target -= 1;
  if (target < 0) return 0;
  const previousBar = timeline[target].barKey;
  while (target > 0 && timeline[target - 1].barKey === previousBar) target -= 1;
  return target;
}

function commandDestination(
  timeline: PlaybackMoment[],
  index: number,
  command: Exclude<
    PlaybackCommand,
    | "togglePlayback"
    | "stopPlayback"
    | "toggleNoteSounds"
    | "toggleListenMode"
    | "playCurrentNotes"
    | "toggleLoopMode"
  >,
): number {
  if (command === "forwardNote") return Math.min(timeline.length - 1, index + 1);
  if (command === "backwardNote") return Math.max(0, index - 1);
  if (command === "forwardBar") {
    const currentBar = timeline[index].barKey;
    const destination = timeline.findIndex(
      (moment, candidateIndex) => candidateIndex > index && moment.barKey !== currentBar,
    );
    return destination < 0 ? timeline.length - 1 : destination;
  }
  if (command === "backwardBar") return firstMomentOfPreviousBar(timeline, index);
  if (command === "forwardPage") {
    const currentPage = timeline[index].pageIndex;
    const destination = timeline.findIndex(
      (moment, candidateIndex) => candidateIndex > index && moment.pageIndex > currentPage,
    );
    return destination < 0 ? timeline.length - 1 : destination;
  }
  const currentPage = timeline[index].pageIndex;
  let destination = -1;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (timeline[candidateIndex].pageIndex < currentPage) {
      destination = candidateIndex;
      break;
    }
  }
  if (destination < 0) return 0;
  const previousPage = timeline[destination].pageIndex;
  while (destination > 0 && timeline[destination - 1].pageIndex === previousPage) destination -= 1;
  return destination;
}

/**
 * `timeline` is the one being stepped through (one hand's, when practising);
 * `fullTimeline` lets a start position on a skipped moment snap onto it.
 */
export function runPlaybackCommand(
  timeline: PlaybackMoment[],
  state: PlaybackState,
  command: PlaybackCommand,
  selectedGroup: VisualGroupRef | null = null,
  fullTimeline: PlaybackMoment[] = timeline,
): PlaybackState {
  if (command === "stopPlayback") {
    return state.active ? { ...state, active: false, currentMomentId: null } : state;
  }
  if (command === "togglePlayback") {
    if (state.active) {
      return { ...state, active: false, currentMomentId: null, listenModeEnabled: false };
    }
    const next = timeline.length === 0
      ? { ...state, active: false, currentMomentId: null }
      : { ...state, active: true, currentMomentId: timeline[0].id };
    return seekPracticePlaybackToGroup(fullTimeline, timeline, next, selectedGroup);
  }
  if (command === "toggleNoteSounds") {
    return state.active ? { ...state, noteSoundsEnabled: !state.noteSoundsEnabled } : state;
  }
  if (command === "toggleListenMode") {
    return state.active ? { ...state, listenModeEnabled: !state.listenModeEnabled } : state;
  }
  if (command === "playCurrentNotes" || command === "toggleLoopMode") return state;
  if (!state.active || timeline.length === 0) return state;
  const destination = commandDestination(timeline, currentIndex(timeline, state), command);
  return { ...state, active: true, currentMomentId: timeline[destination].id };
}
