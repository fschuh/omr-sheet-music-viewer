import type { DocumentPage, VisualGroup, VisualGroupRef, VisualSidecarNote } from "./types";
import type { PredictedFingering } from "./fingering";
import { musicXmlPitchNames } from "./noteLabels";
import { parseRealtimeMusicXml, type RealtimeScoreNote } from "./realtime";

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
  staffIndex: number;
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
}

interface PlaybackPitchNote {
  musicXmlId: string;
  pitch: string;
}

export function playbackPitchForNote(
  note: VisualSidecarNote,
  pitchNames: ReadonlyMap<string, string>,
): string | null {
  return pitchNames.get(note.musicxml_id) ?? note.pitch;
}

function notesByVisualGroup(
  notes: VisualSidecarNote[],
  pitchNames: ReadonlyMap<string, string>,
): Map<string, VisualSidecarNote[]> {
  const result = new Map<string, VisualSidecarNote[]>();
  for (const note of notes) {
    if (!note.visual_group_id || playbackPitchForNote(note, pitchNames) === null) continue;
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

function measuresCompatible(first: TimelineGroup, cluster: MomentCluster): boolean {
  if (first.measures.size === 0 || cluster.measure === null) return true;
  return first.measures.has(cluster.measure);
}

function sharesStem(first: TimelineGroup, cluster: MomentCluster): boolean {
  const components = new Set(first.group.stem_component_ids ?? []);
  if (components.size === 0) return false;
  return cluster.groups.some((entry) =>
    (entry.group.stem_component_ids ?? []).some((component) => components.has(component)),
  );
}

function updateCluster(cluster: MomentCluster): void {
  cluster.x = cluster.groups.reduce((total, value) => total + value.x, 0) /
    cluster.groups.length;
  cluster.measure = mostCommonMeasure(cluster.groups);
}

function clustersByStem(entries: TimelineGroup[]): MomentCluster[] {
  // Coalesce chord members before sorting by their visual x-position. A displaced
  // second can otherwise be separated from its stemmates by an aligned note on
  // the other stave.
  const clusters: MomentCluster[] = [];
  for (const entry of entries) {
    const matches = clusters
      .map((cluster, index) =>
        measuresCompatible(entry, cluster) && sharesStem(entry, cluster) ? index : -1
      )
      .filter((index) => index >= 0);
    if (matches.length === 0) {
      clusters.push({ groups: [entry], x: entry.x, measure: mostCommonMeasure([entry]) });
      continue;
    }

    const target = clusters[matches[0]];
    target.groups.push(entry);
    for (const index of matches.slice(1).reverse()) {
      target.groups.push(...clusters[index].groups);
      clusters.splice(index, 1);
    }
    updateCluster(target);
  }
  return clusters;
}

function clustersAlign(first: MomentCluster, second: MomentCluster): boolean {
  if (
    first.measure !== null &&
    second.measure !== null &&
    first.measure !== second.measure
  ) {
    return false;
  }
  const typicalWidth = Math.min(
    ...first.groups.map((candidate) => candidate.width),
    ...second.groups.map((candidate) => candidate.width),
  );
  const tolerance = Math.min(24, Math.max(6, typicalWidth * 0.8));
  return Math.abs(first.x - second.x) <= tolerance;
}

function clustersForStaff(
  groups: VisualGroup[],
  notes: VisualSidecarNote[],
  pitchNames: ReadonlyMap<string, string>,
): MomentCluster[] {
  const linkedNotes = notesByVisualGroup(notes, pitchNames);
  const entries = groups
    .map((group): TimelineGroup => {
      const geometry = horizontalGeometry(group);
      const notes = linkedNotes.get(group.visual_group_id) ?? [];
      return {
        group,
        ...geometry,
        measures: new Set(notes.map((note) => note.measure)),
        notes,
      };
    })
    .sort((first, second) => first.x - second.x || first.group.center[1] - second.group.center[1]);
  const clusters: MomentCluster[] = [];
  const stemClusters = clustersByStem(entries)
    .sort((first, second) => first.x - second.x);
  for (const entry of stemClusters) {
    const previous = clusters.at(-1);
    if (previous && clustersAlign(entry, previous)) {
      previous.groups.push(...entry.groups);
      updateCluster(previous);
    } else {
      clusters.push(entry);
    }
  }
  return clusters;
}

function scoreEventNotesById(musicXml?: string): Map<string, readonly RealtimeScoreNote[]> {
  const result = new Map<string, readonly RealtimeScoreNote[]>();
  if (!musicXml) return result;
  try {
    const score = parseRealtimeMusicXml(musicXml);
    for (const measure of score.measures) {
      for (const event of measure.events) {
        for (const note of event.notes) result.set(note.musicXmlId, event.notes);
      }
    }
  } catch {
    // Note-by-note playback can still use the visual sidecar when score parsing fails.
  }
  return result;
}

function playbackNotesForCluster(
  cluster: MomentCluster,
  pitchNames: ReadonlyMap<string, string>,
  scoreEvents: ReadonlyMap<string, readonly RealtimeScoreNote[]>,
): PlaybackPitchNote[] {
  const result: PlaybackPitchNote[] = [];
  const seenIds = new Set<string>();
  const add = (musicXmlId: string, pitch: string | null) => {
    if (pitch === null || seenIds.has(musicXmlId)) return;
    seenIds.add(musicXmlId);
    result.push({ musicXmlId, pitch });
  };

  for (const entry of cluster.groups) {
    for (const note of entry.notes) {
      for (const eventNote of scoreEvents.get(note.musicxml_id) ?? []) {
        add(eventNote.musicXmlId, eventNote.pitch);
      }
    }
  }
  for (const entry of cluster.groups) {
    for (const note of entry.notes) {
      add(note.musicxml_id, playbackPitchForNote(note, pitchNames));
    }
  }
  return result;
}

export function buildPlaybackTimeline(
  pages: DocumentPage[],
  predictedFingerings: Readonly<Record<string, PredictedFingering>> = {},
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
    const pitchNames = musicXmlPitchNames(page.musicXml);
    const scoreEvents = scoreEventNotesById(page.musicXml);
    const staffIndexes = Array.from(
      new Set(sidecar.visual_groups.map((group) => group.staff_index)),
    ).sort((first, second) => first - second);
    for (const staffIndex of staffIndexes) {
      const staffGroups = sidecar.visual_groups.filter((group) => group.staff_index === staffIndex);
      const clusters = clustersForStaff(staffGroups, sidecar.notes, pitchNames);
      clusters.forEach((cluster, clusterIndex) => {
        const momentNotes = playbackNotesForCluster(cluster, pitchNames, scoreEvents);
        const visualGroupIds = cluster.groups
          .map((entry) => entry.group.visual_group_id)
          .sort((first, second) => first.localeCompare(second));
        const pitches = Array.from(new Set(momentNotes.map((note) => note.pitch)));
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
        const unknownBarKey = `page-${page.index}-staff-${staffIndex}-unknown`;
        result.push({
          id: `page-${page.index}-staff-${staffIndex}-moment-${clusterIndex}-${visualGroupIds.join("+")}`,
          pageIndex: page.index,
          staffIndex,
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
