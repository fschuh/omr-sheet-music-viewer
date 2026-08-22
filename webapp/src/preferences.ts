import { DEFAULT_PIANO_ID, isPianoId, type PianoId } from "./pianoRegistry";
import type { ListenInputSource } from "./noteRecognizer";

export const DEBUG_PANEL_STORAGE_KEY = "homr.debug-panel-enabled.v1";
export const PLAYBACK_PIANO_STORAGE_KEY = "homr.playback-piano.v1";
export const LISTEN_INPUT_SOURCE_STORAGE_KEY = "homr.listen-input-source.v1";

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
