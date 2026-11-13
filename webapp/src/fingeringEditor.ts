// The fingering editor's state and actions. Edit fingers is a mode on top of note-by-note
// playback: the note the next digit goes to is a note of the playhead's moment, so fixing a
// finger never loses the player's place, and the arrows move it as they move the playhead.
// A digit sets the note's finger and moves on, top note first, then into the next moment,
// so a run is typed as its digits. Edits are overrides kept apart from the predictions; the
// predictions change only when the player asks for a re-fit.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { FingeringPredictor, PredictedFingering } from "./fingering";
import {
  constraintSignature,
  noteKeyOf,
  refitMusicXmlFingerings,
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
import type { PlaybackMode } from "./realtime";
import type { FingeringLayers, LoadedDocument, VisualGroupRef } from "./types";

/** A document with new fingering layers, and every view's fingerings resolved from them. */
export function withFingeringLayers(document: LoadedDocument, layers: FingeringLayers): LoadedDocument {
  const resolved = resolveFingerings(layers, layers.overrides);
  const plain: Record<string, PredictedFingering> = {};
  for (const [id, fingering] of Object.entries(resolved)) plain[id] = { finger: fingering.finger, left: fingering.left };
  return {
    ...document,
    fingeringLayers: layers,
    predictedFingerings: plain,
    predictedFingeringCount: Object.keys(plain).length,
  };
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
    });
  }
  const midi = (target: EditTarget) => pitchToMidi(target.pitch) ?? 0;
  return targets.sort((a, b) => midi(b) - midi(a) || a.id.localeCompare(b.id));
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
  resolve: (overrides: FingeringOverrides) => Readonly<Record<string, EffectiveFingering>>,
): { overrides: FingeringOverrides; end: number; changed: string[] } {
  let current = overrides;
  let index = start;
  const changed: string[] = [];
  for (const character of text) {
    const target = walk[index];
    if (!target) break;
    const effective = resolve(current)[target.id];
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

interface HistoryEntry {
  overrides: FingeringOverrides;
  cursor: EditTarget | null;
}

const HISTORY_LIMIT = 200;

export interface FingeringEditorOptions {
  document: LoadedDocument | null;
  setDocument: Dispatch<SetStateAction<LoadedDocument | null>>;
  /** The timeline note-by-note steps through: one hand's while practising one. */
  timeline: readonly PlaybackMoment[];
  /** The playhead's moment in note-by-note playback. */
  moment: PlaybackMoment | null;
  playbackActive: boolean;
  playbackMode: PlaybackMode;
  practiceHand: PracticeHand;
  onPracticeHandChange: (hand: PracticeHand) => void;
  /** Starts note-by-note playback. */
  startPlayback: () => void;
  /** Moves the playhead to a note's moment. */
  seek: (group: VisualGroupRef) => void;
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
  exit: () => void;
  /** Sets the cursor's finger and moves on, as typing the digit does. */
  setFinger: (finger: number) => void;
  /** Sets the cursor's finger and stays on it, as picking it in the picker does. */
  pickFinger: (finger: number) => void;
  reset: () => void;
  swapHand: () => void;
  undo: () => void;
  refit: () => void;
  /** Points the editor at a note, moving the playhead to it, and opens its finger picker. */
  select: (id: string, openPicker?: boolean) => void;
  /** Moves within the moment: -1 to the note above, 1 to the note below. */
  moveInMoment: (direction: -1 | 1) => void;
  closePicker: () => void;
  togglePicker: () => void;
  typeRun: (text: string) => void;
}

export function useFingeringEditor(options: FingeringEditorOptions): FingeringEditor {
  const {
    document, setDocument, timeline, moment, playbackActive, playbackMode, practiceHand,
    onPracticeHandChange, startPlayback, seek, predict, onError,
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

  const fingerings = useMemo(
    () => (layers ? resolveFingerings(layers, layers.overrides) : null),
    [layers],
  );
  const walk = useMemo(() => (fingerings ? editWalk(timeline, fingerings) : []), [fingerings, timeline]);
  const momentNotes = useMemo(() => (fingerings ? momentTargets(moment, fingerings) : []), [fingerings, moment]);
  const cursor = editing
    ? momentNotes.find((target) => target.id === cursorId) ?? momentNotes[0] ?? null
    : null;
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
  // Editing follows the note-by-note playhead; it ends with playback.
  useEffect(() => {
    if (!available || !playbackActive || playbackMode !== "note-by-note") {
      setEditing(false);
      setPickerOpen(false);
    }
  }, [available, playbackActive, playbackMode]);
  // A picker belongs to its moment.
  const momentId = moment?.id;
  useEffect(() => {
    setPickerOpen(false);
  }, [momentId]);

  const moveTo = useCallback((target: EditTarget | null) => {
    if (!target) return;
    setCursorId(target.id);
    if (target.momentId !== moment?.id) seek({ pageIndex: target.pageIndex, visualGroupId: target.key });
  }, [moment?.id, seek]);

  const commit = useCallback((next: FingeringOverrides, changed: readonly string[], after: EditTarget | null) => {
    if (!layers || !document) return;
    if (JSON.stringify(next) === JSON.stringify(layers.overrides)) {
      moveTo(after);
      return;
    }
    setHistory((entries) => [...entries, { overrides: layers.overrides, cursor }].slice(-HISTORY_LIMIT));
    setDocument((value) =>
      value?.jobId === document.jobId && value.fingeringLayers
        ? withFingeringLayers(value, { ...value.fingeringLayers, overrides: next })
        : value,
    );
    setFlash((value) => ({ ids: changed, serial: value.serial + 1 }));
    moveTo(after);
    if (layers.overridesError) return;
    // Writes go out in order, so the file ends as the last edit left it.
    saving.current = saving.current
      .then(() => saveMusicXmlFingeringOverrides(document, next))
      .catch((error: unknown) => {
        onError(`Your fingerings could not be saved: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [cursor, document, layers, moveTo, onError, setDocument]);

  const resolve = useCallback(
    (overrides: FingeringOverrides) => (layers ? resolveFingerings(layers, overrides) : {}),
    [layers],
  );
  const cursorIndex = cursor ? walk.findIndex((target) => target.id === cursor.id) : -1;

  const typeRun = useCallback((text: string) => {
    if (!editing || !layers || !cursor) return;
    if (cursorIndex < 0) {
      // A note outside the walk, of the hand not being practised: edit it alone.
      const result = applyTypedRun(text, [cursor], 0, layers.overrides, resolve);
      commit(result.overrides, result.changed, cursor);
      return;
    }
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
  const swapHand = useCallback(() => {
    if (!cursor || !fingerings) return;
    const movedLeft = !fingerings[cursor.id]?.left;
    typeRun("h");
    // A note moved away from the hand being practised leaves its timeline; practise both.
    if (!noteInPracticeHand(movedLeft, practiceHand)) onPracticeHandChange("both");
  }, [cursor, fingerings, onPracticeHandChange, practiceHand, typeRun]);

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last || !document) return;
    setHistory(history.slice(0, -1));
    setDocument((value) =>
      value?.jobId === document.jobId && value.fingeringLayers
        ? withFingeringLayers(value, { ...value.fingeringLayers, overrides: last.overrides })
        : value,
    );
    if (last.cursor) setFlash((value) => ({ ids: [last.cursor!.id], serial: value.serial + 1 }));
    moveTo(last.cursor);
    if (layers?.overridesError) return;
    saving.current = saving.current
      .then(() => saveMusicXmlFingeringOverrides(document, last.overrides))
      .catch((error: unknown) => {
        onError(`Your fingerings could not be saved: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [document, history, layers?.overridesError, moveTo, onError, setDocument]);

  const refit = useCallback(() => {
    if (!layers || !document || refitting) return;
    const jobId = document.jobId;
    setRefitting(true);
    void refitMusicXmlFingerings(document, predict, layers, layers.overrides)
      .then((result) => {
        setDocument((value) =>
          value?.jobId === jobId && value.fingeringLayers
            ? withFingeringLayers(value, { ...value.fingeringLayers, ...result })
            : value,
        );
      })
      .catch((error: unknown) => {
        onError(`The fingerings could not be re-fitted: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => setRefitting(false));
  }, [document, layers, onError, predict, refitting, setDocument]);

  const toggle = useCallback(() => {
    if (!available) return;
    if (editing) {
      setEditing(false);
      setPickerOpen(false);
      return;
    }
    if (playbackMode !== "note-by-note") return;
    if (!playbackActive) startPlayback();
    setEditing(true);
  }, [available, editing, playbackActive, playbackMode, startPlayback]);
  const exit = useCallback(() => {
    setEditing(false);
    setPickerOpen(false);
  }, []);

  // A note of the hand not being practised is reached by practising both, once the
  // timeline holds it again.
  const pendingSeek = useRef<VisualGroupRef | null>(null);
  useEffect(() => {
    const group = pendingSeek.current;
    if (!group || !walk.some((target) => target.pageIndex === group.pageIndex && target.key === group.visualGroupId)) return;
    pendingSeek.current = null;
    seek(group);
  }, [seek, walk]);

  const select = useCallback((id: string, openPicker = true) => {
    if (!fingerings?.[id]) return;
    const target = walk.find((candidate) => candidate.id === id);
    if (target) moveTo(target);
    else {
      const match = /^page-(\d+)-(.+)$/.exec(id);
      if (!match) return;
      setCursorId(id);
      pendingSeek.current = { pageIndex: Number(match[1]) - 1, visualGroupId: noteKeyOf(id) };
      onPracticeHandChange("both");
    }
    if (openPicker) {
      setEditing(true);
      setPickerOpen(true);
    }
  }, [fingerings, moveTo, onPracticeHandChange, walk]);

  const moveInMoment = useCallback((direction: -1 | 1) => {
    if (!cursor) return;
    const index = momentNotes.findIndex((target) => target.id === cursor.id);
    const next = momentNotes[index + direction];
    if (next) setCursorId(next.id);
  }, [cursor, momentNotes]);

  return {
    available,
    editing,
    fingerings,
    cursor,
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
    swapHand,
    undo,
    refit,
    select,
    moveInMoment,
    closePicker: useCallback(() => setPickerOpen(false), []),
    togglePicker: useCallback(() => setPickerOpen((open) => !open), []),
    typeRun,
  };
}
