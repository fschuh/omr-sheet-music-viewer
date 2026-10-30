import { DEFAULT_PIANO_ID, isPianoId, type PianoId } from "./pianoRegistry";
import type { ListenInputSource } from "@fschuh/piano-transcription-engine";
import type { RepairSettings } from "./native";
import { normalizeKeyboardViewSettings, type KeyboardViewSettings } from "./keyboardView";
import { DEFAULT_REALTIME_COUNT_IN, REALTIME_COUNT_INS, type RealtimeCountIn } from "./realtime";

export const DEBUG_PANEL_STORAGE_KEY = "homr.debug-panel-enabled.v1";
export const PLAYBACK_PIANO_STORAGE_KEY = "homr.playback-piano.v1";
export const LISTEN_INPUT_SOURCE_STORAGE_KEY = "homr.listen-input-source.v1";
export const NOTE_HIGHWAY_STORAGE_KEY = "homr.note-highway-enabled.v1";
export const LOOP_DIM_OUTSIDE_STORAGE_KEY = "homr.loop-dim-outside.v1";
export const REALTIME_COUNT_IN_STORAGE_KEY = "homr.realtime-count-in.v1";
export const SHARED_NOTEHEAD_TIMING_STORAGE_KEY = "homr.repair-shared-notehead-timing.v1";
export const TIME_SIGNATURE_REPAIR_STORAGE_KEY = "homr.repair-time-signatures.v1";
export const TUPLET_REPAIR_STORAGE_KEY = "homr.repair-tuplets.v1";
export const KEYBOARD_VIEW_STORAGE_KEY = "homr.keyboard-view.v1";
export const LAST_SCORE_PATH_STORAGE_KEY = "homr.last-score-path.v1";

export function loadDebugPanelEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEBUG_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveDebugPanelEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEBUG_PANEL_STORAGE_KEY, String(enabled));
  } catch {
    // A disabled/full local store should not prevent changing the setting for this session.
  }
}

export function loadNoteHighwayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NOTE_HIGHWAY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveNoteHighwayEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTE_HIGHWAY_STORAGE_KEY, String(enabled));
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

/** On unless it was switched off. */
export function loadLoopDimOutside(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(LOOP_DIM_OUTSIDE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveLoopDimOutside(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOOP_DIM_OUTSIDE_STORAGE_KEY, String(enabled));
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

/** How long realtime counts in before its first note; short unless changed. */
export function loadRealtimeCountIn(): RealtimeCountIn {
  if (typeof window === "undefined") return DEFAULT_REALTIME_COUNT_IN;
  try {
    const stored = window.localStorage.getItem(REALTIME_COUNT_IN_STORAGE_KEY);
    return REALTIME_COUNT_INS.find((countIn) => countIn === stored) ?? DEFAULT_REALTIME_COUNT_IN;
  } catch {
    return DEFAULT_REALTIME_COUNT_IN;
  }
}

export function saveRealtimeCountIn(countIn: RealtimeCountIn): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REALTIME_COUNT_IN_STORAGE_KEY, countIn);
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

/** On unless it was switched off: a repair is part of recognizing a score correctly. */
function loadRepair(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function saveRepair(key: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(enabled));
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

export function loadSharedNoteheadTimingRepair(): boolean {
  return loadRepair(SHARED_NOTEHEAD_TIMING_STORAGE_KEY);
}

export function saveSharedNoteheadTimingRepair(enabled: boolean): void {
  saveRepair(SHARED_NOTEHEAD_TIMING_STORAGE_KEY, enabled);
}

export function loadTimeSignatureRepair(): boolean {
  return loadRepair(TIME_SIGNATURE_REPAIR_STORAGE_KEY);
}

export function saveTimeSignatureRepair(enabled: boolean): void {
  saveRepair(TIME_SIGNATURE_REPAIR_STORAGE_KEY, enabled);
}

/** The tuplet repair as chosen; it applies only with the time signature repair on. */
export function loadTupletRepair(): boolean {
  return loadRepair(TUPLET_REPAIR_STORAGE_KEY);
}

export function saveTupletRepair(enabled: boolean): void {
  saveRepair(TUPLET_REPAIR_STORAGE_KEY, enabled);
}

/** The repairs a score is opened with: tuplets only where time signatures are read. */
export function repairSettings(
  sharedNoteheadTiming: boolean,
  timeSignatures: boolean,
  tuplets: boolean,
): RepairSettings {
  return { sharedNoteheadTiming, timeSignatures, tuplets: timeSignatures && tuplets };
}

export function loadPlaybackPiano(): PianoId {
  if (typeof window === "undefined") return DEFAULT_PIANO_ID;
  try {
    const stored = window.localStorage.getItem(PLAYBACK_PIANO_STORAGE_KEY);
    return isPianoId(stored) ? stored : DEFAULT_PIANO_ID;
  } catch {
    return DEFAULT_PIANO_ID;
  }
}

export function savePlaybackPiano(pianoId: PianoId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYBACK_PIANO_STORAGE_KEY, pianoId);
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

export function loadListenInputSource(): ListenInputSource {
  if (typeof window === "undefined") return "microphone";
  try {
    return window.localStorage.getItem(LISTEN_INPUT_SOURCE_STORAGE_KEY) === "midi"
      ? "midi"
      : "microphone";
  } catch {
    return "microphone";
  }
}

export function saveListenInputSource(inputSource: ListenInputSource): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LISTEN_INPUT_SOURCE_STORAGE_KEY, inputSource);
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

/** The keyboard and highway look; defaults for anything missing or unreadable. */
export function loadKeyboardViewSettings(): KeyboardViewSettings {
  if (typeof window === "undefined") return normalizeKeyboardViewSettings(null);
  try {
    const stored = window.localStorage.getItem(KEYBOARD_VIEW_STORAGE_KEY);
    return normalizeKeyboardViewSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return normalizeKeyboardViewSettings(null);
  }
}

export function saveKeyboardViewSettings(settings: KeyboardViewSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEYBOARD_VIEW_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A disabled/full local store should not prevent changing the current session.
  }
}

export function loadLastScorePath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_SCORE_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLastScorePath(path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SCORE_PATH_STORAGE_KEY, path);
  } catch {
    // A disabled/full local store only means the next dialog starts in the default folder.
  }
}
