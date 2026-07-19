import assert from "node:assert/strict";
import test from "node:test";
import {
  commandForKeyboardEvent,
  commandForMidiShortcut,
  defaultPlaybackShortcuts,
  formatKeyboardShortcut,
  midiShortcutFromBytes,
  parsePlaybackShortcuts,
} from "./shortcuts";

function keyEvent(code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent;
}

test("default shortcuts reproduce the existing playback keys", () => {
  const shortcuts = defaultPlaybackShortcuts();
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Space")), "togglePlayback");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowRight")), "forwardNote");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowLeft")), "backwardNote");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Period")), "forwardBar");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Comma")), "backwardBar");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowDown")), "forwardPage");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowUp")), "backwardPage");
});

test("keyboard matching includes modifiers", () => {
  const shortcuts = defaultPlaybackShortcuts();
  shortcuts.forwardNote.keyboard = { code: "KeyN", ctrl: true, alt: false, shift: true, meta: false };
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyN", { ctrlKey: true, shiftKey: true })), "forwardNote");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyN", { ctrlKey: true })), null);
  assert.equal(formatKeyboardShortcut(shortcuts.forwardNote.keyboard), "Ctrl + Shift + N");
});

test("MIDI bindings match the same message on every channel", () => {
  const shortcuts = defaultPlaybackShortcuts();
  const learned = midiShortcutFromBytes([0x91, 60, 127]);
  const anotherChannel = midiShortcutFromBytes([0x9e, 60, 127]);
  assert.deepEqual(learned, { status: 0x90, data: [60, 127] });
  assert.deepEqual(anotherChannel, learned);
  shortcuts.forwardNote.midi = learned;
  assert.equal(commandForMidiShortcut(shortcuts, anotherChannel!), "forwardNote");
  assert.equal(commandForMidiShortcut(shortcuts, midiShortcutFromBytes([0x9e, 60, 0])!), null);
});

test("invalid saved values fall back safely without dropping valid bindings", () => {
  const parsed = parsePlaybackShortcuts({
    forwardNote: {
      keyboard: { code: "KeyN", ctrl: true, alt: false, shift: false, meta: false },
      midi: { status: 0xb0, data: [64, 127] },
    },
    backwardNote: { keyboard: { code: "", ctrl: false }, midi: { status: 0xf0, data: [] } },
  });
  assert.equal(formatKeyboardShortcut(parsed.forwardNote.keyboard), "Ctrl + N");
  assert.deepEqual(parsed.forwardNote.midi, { status: 0xb0, data: [64, 127] });
  assert.equal(formatKeyboardShortcut(parsed.backwardNote.keyboard), "Left Arrow");
  assert.equal(parsed.backwardNote.midi, null);
});
