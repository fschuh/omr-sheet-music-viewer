import assert from "node:assert/strict";
import test from "node:test";
import {
  commandForKeyboardEvent,
  commandForMidiShortcut,
  defaultPlaybackShortcuts,
  formatKeyboardShortcut,
  midiShortcutIsRelease,
  midiShortcutFromBytes,
  midiShortcutSupportsHold,
  parsePlaybackShortcuts,
} from "./shortcuts";

function keyEvent(code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent;
}

test("default shortcuts reproduce the existing playback keys", () => {
  const shortcuts = defaultPlaybackShortcuts();
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Space")), "togglePlayback");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Escape")), "stopPlayback");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyM")), "toggleNoteSounds");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyI")), "toggleListenMode");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyP")), "playCurrentNotes");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Backspace")), "rewind");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyL")), "toggleLoopMode");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowRight")), "forwardNote");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowLeft")), "backwardNote");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Period")), "forwardBar");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("Comma")), "backwardBar");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowDown")), "forwardPage");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowUp")), "backwardPage");
  // Shift turns the page arrows into tempo, which reads the same on every keyboard layout.
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowUp", { shiftKey: true })), "tempoUp");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowDown", { shiftKey: true })), "tempoDown");
  assert.equal(formatKeyboardShortcut(shortcuts.tempoUp.keyboard), "Shift + Up Arrow");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyR")), "resetTempo");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyD")), "toggleNoteHighway");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("KeyN")), "togglePlaybackMode");
  // The bracket keys pick a hand by which side of the pair they are.
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("BracketLeft")), "practiceLeftHand");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("BracketRight")), "practiceRightHand");
  assert.equal(formatKeyboardShortcut(shortcuts.practiceLeftHand.keyboard), "[");
  // Shift with the note arrows moves the loop's end, as a selection grows; Ctrl adds its start.
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowRight", { shiftKey: true })), "loopEndLater");
  assert.equal(commandForKeyboardEvent(shortcuts, keyEvent("ArrowLeft", { shiftKey: true })), "loopEndEarlier");
  assert.equal(
    commandForKeyboardEvent(shortcuts, keyEvent("ArrowLeft", { shiftKey: true, ctrlKey: true })),
    "loopStartEarlier",
  );
  assert.equal(
    commandForKeyboardEvent(shortcuts, keyEvent("ArrowRight", { shiftKey: true, ctrlKey: true })),
    "loopStartLater",
  );
});

test("old persisted settings receive the new listen and audition defaults", () => {
  const parsed = parsePlaybackShortcuts({
    togglePlayback: {
      keyboard: { code: "Enter", ctrl: false, alt: false, shift: false, meta: false },
      midi: null,
    },
  });
  assert.equal(commandForKeyboardEvent(parsed, keyEvent("Enter")), "togglePlayback");
  assert.equal(commandForKeyboardEvent(parsed, keyEvent("KeyI")), "toggleListenMode");
  assert.equal(commandForKeyboardEvent(parsed, keyEvent("KeyP")), "playCurrentNotes");
  assert.equal(commandForKeyboardEvent(parsed, keyEvent("KeyL")), "toggleLoopMode");
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

test("MIDI note and control presses recognize their release on every channel", () => {
  const notePress = midiShortcutFromBytes([0x91, 60, 100])!;
  assert.equal(midiShortcutSupportsHold(notePress), true);
  assert.equal(midiShortcutIsRelease(notePress, midiShortcutFromBytes([0x8f, 60, 64])!), true);
  assert.equal(midiShortcutIsRelease(notePress, midiShortcutFromBytes([0x9a, 60, 0])!), true);
  assert.equal(midiShortcutIsRelease(notePress, midiShortcutFromBytes([0x8f, 61, 64])!), false);

  const controlPress = midiShortcutFromBytes([0xb2, 64, 127])!;
  assert.equal(midiShortcutSupportsHold(controlPress), true);
  assert.equal(midiShortcutIsRelease(controlPress, midiShortcutFromBytes([0xbd, 64, 0])!), true);
  assert.equal(midiShortcutIsRelease(controlPress, midiShortcutFromBytes([0xbd, 65, 0])!), false);

  assert.equal(midiShortcutSupportsHold(midiShortcutFromBytes([0xc0, 4])!), false);
  assert.equal(midiShortcutSupportsHold(midiShortcutFromBytes([0xb0, 64, 0])!), false);
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
