import { playbackCommandNames, type PlaybackCommand } from "./playback";

export interface KeyboardShortcut {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface MidiShortcut {
  /** MIDI channel voice status with the channel nibble removed. */
  status: number;
  data: number[];
}

export interface PlaybackShortcut {
  keyboard: KeyboardShortcut;
  midi: MidiShortcut | null;
}

export type PlaybackShortcuts = Record<PlaybackCommand, PlaybackShortcut>;

export const SHORTCUT_STORAGE_KEY = "homr.playback-shortcuts.v1";

export const playbackCommandDetails: ReadonlyArray<{
  command: PlaybackCommand;
  label: string;
  description: string;
}> = [
  { command: "togglePlayback", label: "Primary playback action", description: "Start or exit note-by-note playback, or pause and resume realtime playback." },
  { command: "stopPlayback", label: "Stop playback", description: "Stop either playback mode and clear its playhead." },
  { command: "toggleNoteSounds", label: "Play or mute notes", description: "Toggle piano sound for the current note or chord." },
  { command: "forwardNote", label: "Next note", description: "Move to the next note or chord." },
  { command: "backwardNote", label: "Previous note", description: "Move to the previous note or chord." },
  { command: "forwardBar", label: "Next bar", description: "Move to the first note of the next bar." },
  { command: "backwardBar", label: "Previous bar", description: "Move to the first note of the previous bar." },
  { command: "forwardPage", label: "Next page", description: "Move to the first note of the next page." },
  { command: "backwardPage", label: "Previous page", description: "Move to the first note of the previous page." },
];

function keyboard(code: string): KeyboardShortcut {
  return { code, ctrl: false, alt: false, shift: false, meta: false };
}

export function defaultPlaybackShortcuts(): PlaybackShortcuts {
  return {
    togglePlayback: { keyboard: keyboard("Space"), midi: null },
    stopPlayback: { keyboard: keyboard("Escape"), midi: null },
    toggleNoteSounds: { keyboard: keyboard("KeyM"), midi: null },
    forwardNote: { keyboard: keyboard("ArrowRight"), midi: null },
    backwardNote: { keyboard: keyboard("ArrowLeft"), midi: null },
    forwardBar: { keyboard: keyboard("Period"), midi: null },
    backwardBar: { keyboard: keyboard("Comma"), midi: null },
    forwardPage: { keyboard: keyboard("ArrowDown"), midi: null },
    backwardPage: { keyboard: keyboard("ArrowUp"), midi: null },
  };
}

function validKeyboardShortcut(value: unknown): value is KeyboardShortcut {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KeyboardShortcut>;
  return (
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.ctrl === "boolean" &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.shift === "boolean" &&
    typeof candidate.meta === "boolean"
  );
}

function expectedMidiDataLength(status: number): number | null {
  if (status < 0x80 || status > 0xe0 || status % 0x10 !== 0) return null;
  return status === 0xc0 || status === 0xd0 ? 1 : 2;
}

function sanitizedMidiShortcut(value: unknown): MidiShortcut | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MidiShortcut>;
  const expectedLength = typeof candidate.status === "number"
    ? expectedMidiDataLength(candidate.status)
    : null;
  if (
    expectedLength === null ||
    !Array.isArray(candidate.data) ||
    candidate.data.length < expectedLength
  ) {
    return null;
  }
  const data = candidate.data.slice(0, expectedLength);
  if (!data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0x7f)) return null;
  return { status: candidate.status as number, data };
}

export function parsePlaybackShortcuts(value: unknown): PlaybackShortcuts {
  const result = defaultPlaybackShortcuts();
  if (!value || typeof value !== "object") return result;
  const stored = value as Partial<Record<PlaybackCommand, Partial<PlaybackShortcut>>>;
  for (const command of playbackCommandNames) {
    const candidate = stored[command];
    if (!candidate || typeof candidate !== "object") continue;
    if (validKeyboardShortcut(candidate.keyboard)) {
      result[command].keyboard = { ...candidate.keyboard };
    }
    result[command].midi = sanitizedMidiShortcut(candidate.midi);
  }
  return result;
}

export function loadPlaybackShortcuts(): PlaybackShortcuts {
  if (typeof window === "undefined") return defaultPlaybackShortcuts();
  try {
    const stored = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    return stored ? parsePlaybackShortcuts(JSON.parse(stored)) : defaultPlaybackShortcuts();
  } catch {
    return defaultPlaybackShortcuts();
  }
}

export function savePlaybackShortcuts(shortcuts: PlaybackShortcuts): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
  } catch {
    // A disabled/full local store should not make playback unusable for this session.
  }
}

export function keyboardShortcutFromEvent(event: KeyboardEvent): KeyboardShortcut | null {
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)) {
    return null;
  }
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

export function keyboardShortcutsEqual(left: KeyboardShortcut, right: KeyboardShortcut): boolean {
  return (
    left.code === right.code &&
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta
  );
}

export function commandForKeyboardEvent(
  shortcuts: PlaybackShortcuts,
  event: KeyboardEvent,
): PlaybackCommand | null {
  const received = keyboardShortcutFromEvent(event);
  if (!received) return null;
  return playbackCommandNames.find((command) => (
    keyboardShortcutsEqual(shortcuts[command].keyboard, received)
  )) ?? null;
}

const keyLabels: Record<string, string> = {
  Space: "Space",
  ArrowRight: "Right Arrow",
  ArrowLeft: "Left Arrow",
  ArrowDown: "Down Arrow",
  ArrowUp: "Up Arrow",
  Period: ".",
  Comma: ",",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Tab: "Tab",
};

function keyLabel(code: string): string {
  if (keyLabels[code]) return keyLabels[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function formatKeyboardShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.meta) parts.push("Win");
  parts.push(keyLabel(shortcut.code));
  return parts.join(" + ");
}

export function midiShortcutFromBytes(bytes: readonly number[]): MidiShortcut | null {
  if (bytes.length < 2 || !Number.isInteger(bytes[0])) return null;
  const status = bytes[0] & 0xf0;
  const expectedLength = expectedMidiDataLength(status);
  if (expectedLength === null || bytes.length < expectedLength + 1) return null;
  const data = bytes.slice(1, expectedLength + 1);
  if (!data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0x7f)) return null;
  return { status, data };
}

export function midiShortcutsEqual(left: MidiShortcut, right: MidiShortcut): boolean {
  return left.status === right.status &&
    left.data.length === right.data.length &&
    left.data.every((byte, index) => byte === right.data[index]);
}

export function midiShortcutSupportsHold(shortcut: MidiShortcut): boolean {
  const value = shortcut.data[1] ?? 0;
  return [0x90, 0xa0, 0xb0].includes(shortcut.status) && value > 0;
}

export function midiShortcutIsRelease(
  pressed: MidiShortcut,
  received: MidiShortcut,
): boolean {
  const sameControl = pressed.data[0] === received.data[0];
  if (!sameControl) return false;
  if (pressed.status === 0x90 && pressed.data[1] > 0) {
    return received.status === 0x80 ||
      (received.status === 0x90 && received.data[1] === 0);
  }
  if ([0xa0, 0xb0].includes(pressed.status) && pressed.data[1] > 0) {
    return received.status === pressed.status && received.data[1] === 0;
  }
  return false;
}

export function commandForMidiShortcut(
  shortcuts: PlaybackShortcuts,
  received: MidiShortcut,
): PlaybackCommand | null {
  return playbackCommandNames.find((command) => {
    const assigned = shortcuts[command].midi;
    return assigned ? midiShortcutsEqual(assigned, received) : false;
  }) ?? null;
}

function midiNoteName(number: number): string {
  const pitchClasses = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${pitchClasses[number % 12]}${Math.floor(number / 12) - 1}`;
}

export function formatMidiShortcut(shortcut: MidiShortcut): string {
  const [first = 0, second = 0] = shortcut.data;
  let message: string;
  switch (shortcut.status) {
    case 0x80: message = `Note Off ${midiNoteName(first)} (${first}) · ${second}`; break;
    case 0x90: message = `Note On ${midiNoteName(first)} (${first}) · ${second}`; break;
    case 0xa0: message = `Poly Pressure ${first} · ${second}`; break;
    case 0xb0: message = `Control Change ${first} · ${second}`; break;
    case 0xc0: message = `Program Change ${first + 1}`; break;
    case 0xd0: message = `Channel Pressure ${first}`; break;
    case 0xe0: message = `Pitch Bend ${first + second * 128}`; break;
    default: message = shortcut.data.join(" · ");
  }
  return `${message} · any channel`;
}
