// The fingering editor's state and actions. Edit fingers is a mode of its own: playback
// stops while it is on, and the editor keeps its own cursor, the note the next digit goes
// to, which starts where the playhead or the selection was. The arrows and bar and page keys
// move the cursor as they move the playhead; nothing sounds unless asked. A digit sets the
// note's finger and moves on, top note first, then into the next moment, so a run is typed
// as its digits. Edits are overrides kept apart from the predictions; the predictions
// change only when the player asks for a re-fit.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { FingeringPredictor, PredictedFingering } from "./fingering";
import {
  constraintSignature,
  refitMusicXmlFingerings,
  resolveFingering,
  resolveFingerings,
  saveMusicXmlFingeringOverrides,
  withOverride,
  type EffectiveFingering,
  type FingeringOverride,
  type FingeringOverrides,
} from "./musicxml";
import type { PlaybackMoment, PracticeHand } from "./playback";
import { noteInPracticeHand } from "./playback";
import { pitchToMidi } from "./piano";
import type { FingeringLayers, LoadedDocument } from "./types";

/** A document with new fingering layers, and every view's fingerings resolved from them. */
export function withFingeringLayers(document: LoadedDocument, layers: FingeringLayers): LoadedDocument {
  const resolved = resolveFingerings(layers, layers.overrides);
  const plain: Record<string, PredictedFingering> = {};
  for (const [id, fingering] of Object.entries(resolved)) plain[id] = { finger: fingering.finger, left: fingering.left };
  return {
    ...document,
    fingeringLayers: layers,
    resolvedFingerings: resolved,
    predictedFingerings: plain,
    predictedFingeringCount: Object.keys(plain).length,
  };
}

/** MIDI numbers by pitch name, parsed once each: the walk sorts every moment by pitch. */
const midiByPitch = new Map<string, number>();
function pitchMidi(pitch: string): number {
  let midi = midiByPitch.get(pitch);
  if (midi === undefined) {
    midi = pitchToMidi(pitch) ?? 0;
    midiByPitch.set(pitch, midi);
  }
  return midi;
}

/** A note the editor can set a finger for. */
export interface EditTarget {
  /** Viewer ID. */
  id: string;
  pageIndex: number;
  /** Structural note key, which is also the note's notehead ID on its page. */
  key: string;
  pitch: string;
  momentId: string;
  /** The moment's bar, as playback counts them. */
  measure: number | null;
  /** Moments of one bar share this key. */
  barKey: string;
}

/** The moment's notes that have a finger, top note first. */
export function momentTargets(
  moment: PlaybackMoment | null,
  fingerings: Readonly<Record<string, unknown>>,
): EditTarget[] {
  if (!moment?.notes) return [];
  const seen = new Set<string>();
  const targets: EditTarget[] = [];
  for (const note of moment.notes) {
    if (!note.startsAttack) continue;
    const id = `page-${moment.pageIndex + 1}-${note.visualGroupId}`;
    if (seen.has(id) || !fingerings[id]) continue;
    seen.add(id);
    targets.push({
      id,
      pageIndex: moment.pageIndex,
      key: note.visualGroupId,
      pitch: note.pitch,
      momentId: moment.id,
      measure: moment.measure,
      barKey: moment.barKey,
    });
  }
  if (targets.length < 2) return targets;
  return targets.sort((a, b) => pitchMidi(b.pitch) - pitchMidi(a.pitch) || a.id.localeCompare(b.id));
}

/** Every note of the timeline the editor can step through, in playing order. */
export function editWalk(
  timeline: readonly PlaybackMoment[],
  fingerings: Readonly<Record<string, unknown>>,
): EditTarget[] {
  return timeline.flatMap((moment) => momentTargets(moment, fingerings));
}

/**
 * The overrides after applying typed characters from `start` on: 1–5 set the finger and
 * move on, 0 goes back to the printed or predicted finger and moves on, and h moves the
 * note to the other hand and stays. Returns where the walk ended and every note changed.
 */
export function applyTypedRun(
  text: string,
  walk: readonly EditTarget[],
  start: number,
  overrides: FingeringOverrides,
  /** One note's finger and hand under the given overrides. */
  resolve: (overrides: FingeringOverrides, id: string) => EffectiveFingering | undefined,
): { overrides: FingeringOverrides; end: number; changed: string[] } {
  let current = overrides;
  let index = start;
  const changed: string[] = [];
  for (const character of text) {
    const target = walk[index];
    if (!target) break;
    const effective = resolve(current, target.id);
    if (!effective) continue;
    let change: FingeringOverride | null | undefined;
    let advance = true;
    if (/^[1-5]$/.test(character)) change = { finger: Number(character) };
    else if (character === "0") change = null;
    else if (character === "h" || character === "H") {
      change = { left: !effective.left };
      advance = false;
    } else continue;
    current = withOverride(current, target.id, change, effective);
    changed.push(target.id);
    if (advance) index = Math.min(index + 1, walk.length - 1);
  }
  return { overrides: current, end: index, changed };
}

/** How the editor's cursor is moved: as the same commands move the playhead. */
export type EditNavigation =
  | "forwardNote"
  | "backwardNote"
  | "forwardBar"
  | "backwardBar"
  | "forwardPage"
  | "backwardPage"
  | "rewind";

export function isEditNavigation(command: string): command is EditNavigation {
  return command === "forwardNote" || command === "backwardNote" || command === "forwardBar" ||
    command === "backwardBar" || command === "forwardPage" || command === "backwardPage" || command === "rewind";
}

/** The first note of the run of notes around `index` that share `group`. */
function runStart(walk: readonly EditTarget[], index: number, group: (target: EditTarget) => string | number): number {
  let start = index;
  while (start > 0 && group(walk[start - 1]) === group(walk[index])) start -= 1;
  return start;
}

/**
 * Where a navigation command takes the cursor in the walk: by note, to the first note of
 * the next or previous bar or page, or to the start. A step back by bar or page goes to the
 * start of the one before, as playback's does.
 */
export function navigateWalk(walk: readonly EditTarget[], index: number, command: EditNavigation): number {
  if (walk.length === 0) return -1;
  const last = walk.length - 1;
  const at = Math.min(Math.max(index, 0), last);
  if (command === "rewind") return 0;
  if (command === "forwardNote") return Math.min(at + 1, last);
  if (command === "backwardNote") return Math.max(at - 1, 0);
  const group = command === "forwardBar" || command === "backwardBar"
    ? (target: EditTarget) => `${target.pageIndex}|${target.barKey}`
    : (target: EditTarget) => target.pageIndex;
  if (command === "forwardBar" || command === "forwardPage") {
    const next = walk.findIndex((target, candidate) => candidate > at && group(target) !== group(walk[at]));
    return next < 0 ? last : next;
  }
  const start = runStart(walk, at, group);
  return start === 0 ? 0 : runStart(walk, start - 1, group);
}

interface HistoryEntry {
  overrides: FingeringOverrides;
  cursorId: string | null;
}

const HISTORY_LIMIT = 200;

export interface FingeringEditorOptions {
  document: LoadedDocument | null;
  setDocument: Dispatch<SetStateAction<LoadedDocument | null>>;
  /** The timeline the cursor walks: one hand's while practising one. */
  timeline: readonly PlaybackMoment[];
  playbackActive: boolean;
  /**
   * Where entering edit mode puts the cursor: note-by-note's moment, else one of the notes
   * realtime played last, else the selected note.
   */
  startMomentId: string | null;
  /** Read when edit mode is entered, before playback stops. */
  playheadNoteIds: () => readonly string[];
  startNoteId: string | null;
  practiceHand: PracticeHand;
  onPracticeHandChange: (hand: PracticeHand) => void;
  /** Stops playback of either kind. */
  stopPlayback: () => void;
  /**
   * Called on leaving edit mode, with the note last ringed; `resume` when playback was on
   * when edit mode began.
   */
  onLeave: (cursor: EditTarget | null, resume: boolean) => void;
  /** Plays a moment's notes. */
  audition: (moment: PlaybackMoment) => void;
  predict: FingeringPredictor;
  onError: (message: string) => void;
}

export interface FingeringEditor {
  /** A MusicXML score with fingerings is open. */
  available: boolean;
  editing: boolean;
  /** Each note's finger and where it comes from, by viewer ID. */
  fingerings: Readonly<Record<string, EffectiveFingering>> | null;
  /** The note the next digit goes to. */
  cursor: EditTarget | null;
  /** The cursor's moment. */
  cursorMoment: PlaybackMoment | null;
  /** The cursor's moment's notes, top first. */
  momentNotes: EditTarget[];
  pickerOpen: boolean;
  /** Notes changed by the last edit, which flash; `serial` restarts the flash. */
  flash: { ids: readonly string[]; serial: number };
  overrideCount: number;
  /** The predictions were fitted to other overrides than the current ones. */
  refitNeeded: boolean;
  refitting: boolean;
  canUndo: boolean;
  /** Edits are kept for this session only, and why. */
  unsavedReason: string | null;
  toggle: () => void;
  /** Leaves edit mode, back to the playback it began in, at the ringed note. */
  exit: () => void;
  /** Sets the cursor's finger and moves on, as typing the digit does. */
  setFinger: (finger: number) => void;
  /** Sets the cursor's finger and stays on it, as picking it in the picker does. */
  pickFinger: (finger: number) => void;
  /** Back to the printed or predicted finger, and on to the next note, as typing 0 does. */
  reset: () => void;
  /** Back to the printed or predicted finger, staying on the note, as the picker does. */
  resetHere: () => void;
  swapHand: () => void;
  undo: () => void;
  refit: () => void;
  /** Points the cursor at a note, entering edit mode, and unless told otherwise opens its picker. */
  select: (id: string, openPicker?: boolean) => void;
  navigate: (command: EditNavigation) => void;
  /** Moves within the moment: -1 to the note above, 1 to the note below. */
  moveInMoment: (direction: -1 | 1) => void;
  /** Plays the cursor's moment. */
  audition: () => void;
  closePicker: () => void;
  togglePicker: () => void;
  typeRun: (text: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useFingeringEditor(options: FingeringEditorOptions): FingeringEditor {
  const {
    document, setDocument, timeline, playbackActive, startMomentId, playheadNoteIds, startNoteId, practiceHand,
    onPracticeHandChange, stopPlayback, onLeave, audition, predict, onError,
  } = options;
  const layers = document?.source.kind === "musicxml" && document.fingeringStatus === "ready"
    ? document.fingeringLayers ?? null
    : null;
  const available = layers !== null;
  const [editing, setEditing] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [refitting, setRefitting] = useState(false);
  const [flash, setFlash] = useState<{ ids: readonly string[]; serial: number }>({ ids: [], serial: 0 });
  const saving = useRef<Promise<void>>(Promise.resolve());

  // Resolved once, with the document; resolving again here would double every edit's work.
  const resolved = document?.resolvedFingerings;
  const fingerings = useMemo(
    () => (layers ? resolved ?? resolveFingerings(layers, layers.overrides) : null),
    [layers, resolved],
  );
  const walk = useMemo(() => (fingerings ? editWalk(timeline, fingerings) : []), [fingerings, timeline]);
  const cursorIndex = useMemo(() => {
    const index = walk.findIndex((target) => target.id === cursorId);
    return index < 0 && walk.length > 0 ? 0 : index;
  }, [cursorId, walk]);
  const cursor = editing ? walk[cursorIndex] ?? null : null;
  const cursorMoment = useMemo(
    () => (cursor ? timeline.find((moment) => moment.id === cursor.momentId) ?? null : null),
    [cursor, timeline],
  );
  const momentNotes = useMemo(
    () => (cursor ? walk.filter((target) => target.momentId === cursor.momentId) : []),
    [cursor, walk],
  );
  const refitNeeded = useMemo(
    () => (layers ? constraintSignature(layers.printed, layers.overrides) !== layers.fittedConstraints : false),
    [layers],
  );

  // Each score starts outside edit mode with nothing to undo.
  const jobId = document?.jobId;
  useEffect(() => {
    setEditing(false);
    setCursorId(null);
    setPickerOpen(false);
    setHistory([]);
    setRefitting(false);
  }, [jobId]);
  useEffect(() => {
    if (!available) {
      setEditing(false);
      setPickerOpen(false);
    }
  }, [available]);
  // Playback started while editing takes over; edit mode ends.
  const wasPlaying = useRef(playbackActive);
  useEffect(() => {
    if (playbackActive && !wasPlaying.current) {
      setEditing(false);
      setPickerOpen(false);
    }
    wasPlaying.current = playbackActive;
  }, [playbackActive]);

  const moveTo = useCallback((target: EditTarget | null | undefined) => {
    if (target) setCursorId(target.id);
  }, []);

  const save = useCallback((overrides: FingeringOverrides) => {
    if (!document || layers?.overridesError) return;
    // Writes go out in order, so the file ends as the last edit left it.
    saving.current = saving.current
      .then(() => saveMusicXmlFingeringOverrides(document, overrides))
      .catch((error: unknown) => onError(`Your fingerings could not be saved: ${errorText(error)}`));
  }, [document, layers?.overridesError, onError]);

  const commit = useCallback((next: FingeringOverrides, changed: readonly string[], after: EditTarget | null | undefined) => {
    if (!layers || !document) return;
    moveTo(after);
    if (JSON.stringify(next) === JSON.stringify(layers.overrides)) return;
    setHistory((entries) => [...entries, { overrides: layers.overrides, cursorId: cursor?.id ?? null }].slice(-HISTORY_LIMIT));
    setDocument((value) =>
      value?.jobId === document.jobId && value.fingeringLayers
        ? withFingeringLayers(value, { ...value.fingeringLayers, overrides: next })
        : value,
    );
    setFlash((value) => ({ ids: changed, serial: value.serial + 1 }));
    save(next);
  }, [cursor?.id, document, layers, moveTo, save, setDocument]);

  const resolve = useCallback(
    (overrides: FingeringOverrides, id: string) => (layers ? resolveFingering(layers, overrides, id) : undefined),
    [layers],
  );

  const typeRun = useCallback((text: string) => {
    if (!editing || !layers || !cursor) return;
    const result = applyTypedRun(text, walk, cursorIndex, layers.overrides, resolve);
    // A typed run past the last note stays on it.
    commit(result.overrides, result.changed, walk[result.end] ?? cursor);
    setPickerOpen(false);
  }, [commit, cursor, cursorIndex, editing, layers, resolve, walk]);

  const setFinger = useCallback((finger: number) => typeRun(String(finger)), [typeRun]);
  const pickFinger = useCallback((finger: number) => {
    if (!editing || !layers || !cursor || !fingerings?.[cursor.id]) return;
    commit(withOverride(layers.overrides, cursor.id, { finger }, fingerings[cursor.id]), [cursor.id], cursor);
  }, [commit, cursor, editing, fingerings, layers]);
  const reset = useCallback(() => typeRun("0"), [typeRun]);
  // Moving a note to the other hand stays on it, picker and all, so its finger can be chosen
  // for that hand next.
  const swapHand = useCallback(() => {
    if (!editing || !layers || !cursor || !fingerings?.[cursor.id]) return;
    const movedLeft = !fingerings[cursor.id].left;
    commit(withOverride(layers.overrides, cursor.id, { left: movedLeft }, fingerings[cursor.id]), [cursor.id], cursor);
    // A note moved away from the hand being practised would leave the walk; walk both.
    if (!noteInPracticeHand(movedLeft, practiceHand)) onPracticeHandChange("both");
  }, [commit, cursor, editing, fingerings, layers, onPracticeHandChange, practiceHand]);
  /** Back to the printed or predicted finger, staying on the note, as the picker does. */
  const resetHere = useCallback(() => {
    if (!editing || !layers || !cursor || !fingerings?.[cursor.id]) return;
    commit(withOverride(layers.overrides, cursor.id, null, fingerings[cursor.id]), [cursor.id], cursor);
  }, [commit, cursor, editing, fingerings, layers]);

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last || !document) return;
    setHistory(history.slice(0, -1));
    setDocument((value) =>
      value?.jobId === document.jobId && value.fingeringLayers
        ? withFingeringLayers(value, { ...value.fingeringLayers, overrides: last.overrides })
        : value,
    );
    if (last.cursorId) {
      setCursorId(last.cursorId);
      setFlash((value) => ({ ids: [last.cursorId!], serial: value.serial + 1 }));
    }
    save(last.overrides);
  }, [document, history, save, setDocument]);

  const refit = useCallback(() => {
    if (!layers || !document || refitting) return;
    const refitJob = document.jobId;
    setRefitting(true);
    void refitMusicXmlFingerings(document, predict, layers, layers.overrides)
      .then((result) => {
        setDocument((value) =>
          value?.jobId === refitJob && value.fingeringLayers
            ? withFingeringLayers(value, { ...value.fingeringLayers, ...result })
            : value,
        );
      })
      .catch((error: unknown) => onError(`The fingerings could not be re-fitted: ${errorText(error)}`))
      .finally(() => setRefitting(false));
  }, [document, layers, onError, predict, refitting, setDocument]);

  const enter = useCallback(() => {
    if (!available) return;
    // The cursor starts at the playhead, else at the selected note, else where it last was.
    const fromPlayhead = startMomentId ? walk.find((target) => target.momentId === startMomentId) : undefined;
    // A note realtime is holding is edited through the note that starts its tie.
    const played = new Set(playheadNoteIds().map((id) => fingerings?.[id]?.tiedTo ?? id));
    const fromRealtime = played.size ? walk.find((target) => played.has(target.id)) : undefined;
    const fromSelection = startNoteId ? walk.find((target) => target.id === startNoteId) : undefined;
    const start = fromPlayhead ?? fromRealtime ?? fromSelection;
    if (start) setCursorId(start.id);
    resumePlayback.current = playbackActive;
    if (playbackActive) stopPlayback();
    setEditing(true);
  }, [available, fingerings, playbackActive, playheadNoteIds, startMomentId, startNoteId, stopPlayback, walk]);
  // Whether playback was on when edit mode began, so leaving it goes back to playback.
  const resumePlayback = useRef(false);
  const exit = useCallback(() => {
    if (!editing) return;
    setEditing(false);
    setPickerOpen(false);
    onLeave(cursor, resumePlayback.current);
  }, [cursor, editing, onLeave]);
  const toggle = useCallback(() => (editing ? exit() : enter()), [editing, enter, exit]);

  const select = useCallback((clicked: string, openPicker = true) => {
    // A held note is edited through the note that starts its tie.
    const id = fingerings?.[clicked]?.tiedTo ?? clicked;
    if (!fingerings?.[id]) return;
    if (!editing) enter();
    setCursorId(id);
    // A note of the hand not being practised is reached by walking both.
    if (!walk.some((target) => target.id === id)) onPracticeHandChange("both");
    setPickerOpen(openPicker);
  }, [editing, enter, fingerings, onPracticeHandChange, walk]);

  const navigate = useCallback((command: EditNavigation) => {
    if (!editing) return;
    moveTo(walk[navigateWalk(walk, cursorIndex, command)]);
    setPickerOpen(false);
  }, [cursorIndex, editing, moveTo, walk]);

  const moveInMoment = useCallback((direction: -1 | 1) => {
    if (!cursor) return;
    const index = momentNotes.findIndex((target) => target.id === cursor.id);
    moveTo(momentNotes[index + direction]);
  }, [cursor, momentNotes, moveTo]);

  const auditionCursor = useCallback(() => {
    if (cursorMoment) audition(cursorMoment);
  }, [audition, cursorMoment]);

  return {
    available,
    editing,
    fingerings,
    cursor,
    cursorMoment,
    momentNotes,
    pickerOpen: editing && pickerOpen && cursor !== null,
    flash,
    overrideCount: layers ? Object.keys(layers.overrides).length : 0,
    refitNeeded,
    refitting,
    canUndo: history.length > 0,
    unsavedReason: layers?.overridesError ?? null,
    toggle,
    exit,
    setFinger,
    pickFinger,
    reset,
    resetHere,
    swapHand,
    undo,
    refit,
    select,
    navigate,
    moveInMoment,
    audition: auditionCursor,
    closePicker: useCallback(() => setPickerOpen(false), []),
    togglePicker: useCallback(() => setPickerOpen((open) => !open), []),
    typeRun,
  };
}
