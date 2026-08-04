import type { DocumentPage, VisualGroup, VisualGroupRef, VisualSidecarNote } from "./types";
import { isLinkedVisualGroup } from "./types";
import type { PredictedFingering } from "./fingering";
import {
  parseRealtimeMusicXml,
  scoreNoteStartsAttack,
  type RealtimeScore,
  type RealtimeScoreNote,
} from "./realtime";

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
] as const;

export type PlaybackCommand = (typeof playbackCommandNames)[number];

export interface PlaybackMoment {
  id: string;
  pageIndex: number;
  staffGroupIndex: number;
  measure: number | null;
  barKey: string;
  visualGroupIds: string[];
  pitches: string[];
  keyboardNotes: PlaybackKeyboardNote[];
  center: [number, number];
}

export interface PlaybackKeyboardNote {
  pitch: string;
  finger?: number;
  left?: boolean;
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
  group: VisualGroup;
  x: number;
  width: number;
  measures: Set<number>;
  notes: VisualSidecarNote[];
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
}

export function playbackPitchForNote(note: VisualSidecarNote): string | null {
  return note.pitch;
}

function isGraceNote(note: VisualSidecarNote): boolean {
  return note.duration.startsWith("note_") && note.duration.includes("G");
}

function notesByVisualGroup(
  notes: VisualSidecarNote[],
  suppressedNoteIds: ReadonlySet<string>,
): Map<string, VisualSidecarNote[]> {
  const result = new Map<string, VisualSidecarNote[]>();
  for (const note of notes) {
    if (
      isGraceNote(note) ||
      suppressedNoteIds.has(note.musicxml_id) ||
      !note.visual_group_id ||
      playbackPitchForNote(note) === null
    ) {
      continue;
    }
    const linked = result.get(note.visual_group_id) ?? [];
    linked.push(note);
    result.set(note.visual_group_id, linked);
  }
  return result;
}

function horizontalGeometry(group: VisualGroup): { x: number; width: number } {
  const ellipses = group.notehead_ellipses ?? [];
  if (ellipses.length > 0) {
    const left = Math.min(...ellipses.map((ellipse) => ellipse.center[0] - ellipse.rx));
    const right = Math.max(...ellipses.map((ellipse) => ellipse.center[0] + ellipse.rx));
    return { x: (left + right) / 2, width: Math.max(1, right - left) };
  }
  if (group.bbox.length === 4) {
    return {
      x: (group.bbox[0] + group.bbox[2]) / 2,
      width: Math.max(1, group.bbox[2] - group.bbox[0]),
    };
  }
  return { x: group.center[0], width: 12 };
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

function clustersByMomentIdForStaffGroup(
  groups: VisualGroup[],
  notes: VisualSidecarNote[],
  suppressedNoteIds: ReadonlySet<string>,
): MomentCluster[] {
  const linkedNotes = notesByVisualGroup(notes, suppressedNoteIds);
  const byMoment = new Map<string, TimelineGroup[]>();
  for (const group of groups) {
    if (group.moment_id === null) continue;
    const geometry = horizontalGeometry(group);
    const groupNotes = linkedNotes.get(group.visual_group_id) ?? [];
    const entry: TimelineGroup = {
      group,
      ...geometry,
      measures: new Set(groupNotes.map((note) => note.measure)),
      notes: groupNotes,
    };
    const entries = byMoment.get(group.moment_id) ?? [];
    entries.push(entry);
    byMoment.set(group.moment_id, entries);
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

interface NoteByNoteScoreData {
  suppressedNoteIds: Set<string>;
  startsAttackByNoteId: Map<string, boolean>;
}

function noteForPage(
  note: RealtimeScoreNote,
  musicPageNumber: number,
  documentScore: boolean,
): RealtimeScoreNote | null {
  if (!documentScore) return note;
  const prefix = `page-${musicPageNumber}-`;
  if (!note.musicXmlId.startsWith(prefix)) return null;
  return { ...note, musicXmlId: note.musicXmlId.slice(prefix.length) };
}

function noteByNoteScoreData(
  musicXml: string | undefined,
  musicPageNumber: number,
  documentScore?: RealtimeScore | null,
): NoteByNoteScoreData {
  const suppressedNoteIds = new Set<string>();
  const startsAttackByNoteId = new Map<string, boolean>();
  if (!documentScore && !musicXml) {
    return { suppressedNoteIds, startsAttackByNoteId };
  }
  try {
    const score = documentScore ?? parseRealtimeMusicXml(musicXml!);
    for (const measure of score.measures) {
      for (const event of measure.events) {
        const eventNotes = event.notes
          .map((note) => noteForPage(
            note,
            musicPageNumber,
            documentScore !== null && documentScore !== undefined,
          ))
          .filter((note): note is RealtimeScoreNote => note !== null && !note.grace);
        if (eventNotes.some(scoreNoteStartsAttack)) {
          // Record attack status for every tone in a partial-tie event so the
          // sidecar-defined chord can distinguish held and newly attacked notes.
          for (const note of eventNotes) {
            startsAttackByNoteId.set(note.musicXmlId, scoreNoteStartsAttack(note));
          }
        } else {
          for (const note of eventNotes) {
            suppressedNoteIds.add(note.musicXmlId);
            startsAttackByNoteId.set(note.musicXmlId, false);
          }
        }
      }
    }
  } catch {
    // Note-by-note playback can still use the visual sidecar when score parsing fails.
  }
  return { suppressedNoteIds, startsAttackByNoteId };
}

function playbackNotesForCluster(
  cluster: MomentCluster,
  startsAttackByNoteId: ReadonlyMap<string, boolean>,
): PlaybackPitchNote[] {
  const result: PlaybackPitchNote[] = [];
  const seenIds = new Set<string>();
  const add = (musicXmlId: string, pitch: string | null) => {
    if (pitch === null || seenIds.has(musicXmlId)) return;
    seenIds.add(musicXmlId);
    result.push({
      musicXmlId,
      pitch,
      startsAttack: startsAttackByNoteId.get(musicXmlId) ?? true,
    });
  };

  for (const entry of cluster.groups) {
    for (const note of entry.notes) {
      add(note.musicxml_id, playbackPitchForNote(note));
    }
  }
  return result;
}

export function buildPlaybackTimeline(
  pages: DocumentPage[],
  predictedFingerings: Readonly<Record<string, PredictedFingering>> = {},
  documentScore?: RealtimeScore | null,
): PlaybackMoment[] {
  const result: PlaybackMoment[] = [];
  let musicPageNumber = 0;
  for (const page of [...pages].sort((first, second) => first.index - second.index)) {
    const hasRecognizedScore = Boolean(
      page.musicXml || page.visualSidecar || page.artifacts?.musicXmlPath,
    );
    if (hasRecognizedScore) musicPageNumber += 1;
    const sidecar = page.visualSidecar;
    if (!sidecar) continue;
    const scoreData = noteByNoteScoreData(page.musicXml, musicPageNumber, documentScore);
    const suppressedNoteIds = new Set(scoreData.suppressedNoteIds);
    for (const note of sidecar.notes) {
      if (isGraceNote(note)) suppressedNoteIds.add(note.musicxml_id);
    }
    const eligibleGroups = sidecar.visual_groups.filter(
      (group) =>
        isLinkedVisualGroup(group) &&
        group.musicxml_id !== null &&
        !suppressedNoteIds.has(group.musicxml_id),
    );
    const staffGroupIndexes = Array.from(
      new Set(eligibleGroups.map((group) => group.staff_group_index)),
    ).sort((first, second) => first - second);
    for (const staffGroupIndex of staffGroupIndexes) {
      const staffGroups = eligibleGroups.filter(
        (group) => group.staff_group_index === staffGroupIndex,
      );
      const clusters = clustersByMomentIdForStaffGroup(
        staffGroups,
        sidecar.notes,
        suppressedNoteIds,
      );
      clusters.forEach((cluster, clusterIndex) => {
        const momentNotes = playbackNotesForCluster(
          cluster,
          scoreData.startsAttackByNoteId,
        );
        const visualGroupIds = cluster.groups
          .map((entry) => entry.group.visual_group_id)
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
          const predicted = predictedFingerings[
            `page-${musicPageNumber}-${note.musicXmlId}`
          ];
          const key = `${note.pitch}:${predicted?.left ?? ""}:${predicted?.finger ?? ""}`;
          if (seenKeyboardNotes.has(key)) continue;
          seenKeyboardNotes.add(key);
          keyboardNotes.push({ pitch: note.pitch, ...predicted });
        }
        const centerY =
          cluster.groups.reduce((total, entry) => total + entry.group.center[1], 0) /
          cluster.groups.length;
        const unknownBarKey = `page-${page.index}-staff-group-${staffGroupIndex}-unknown`;
        result.push({
          id: cluster.canonicalMomentId
            ? `page-${page.index}-${cluster.canonicalMomentId}`
            : `page-${page.index}-staff-group-${staffGroupIndex}-moment-${clusterIndex}-${visualGroupIds.join("+")}`,
          pageIndex: page.index,
          staffGroupIndex,
          measure: cluster.measure,
          barKey: cluster.measure === null ? unknownBarKey : `page-${page.index}-measure-${cluster.measure}`,
          visualGroupIds,
          pitches,
          keyboardNotes,
          center: [cluster.x, centerY],
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

export function runPlaybackCommand(
  timeline: PlaybackMoment[],
  state: PlaybackState,
  command: PlaybackCommand,
  selectedGroup: VisualGroupRef | null = null,
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
    return seekPlaybackToGroup(timeline, next, selectedGroup);
  }
  if (command === "toggleNoteSounds") {
    return state.active ? { ...state, noteSoundsEnabled: !state.noteSoundsEnabled } : state;
  }
  if (command === "toggleListenMode") {
    return state.active ? { ...state, listenModeEnabled: !state.listenModeEnabled } : state;
  }
  if (command === "playCurrentNotes") return state;
  if (!state.active || timeline.length === 0) return state;
  const destination = commandDestination(timeline, currentIndex(timeline, state), command);
  return { ...state, active: true, currentMomentId: timeline[destination].id };
}
