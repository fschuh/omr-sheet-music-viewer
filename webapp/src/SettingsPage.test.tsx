import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPage } from "./SettingsPage";
import { defaultPlaybackShortcuts } from "./shortcuts";

test("renders every playback command with its default keyboard key and empty MIDI slot", () => {
  const markup = renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      nativeAvailable
      midiPorts={["Bluetooth MIDI bridge"]}
      midiError={null}
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onBeginMidiCapture={() => undefined}
      onCancelMidiCapture={() => undefined}
      onRefreshMidiInputs={() => undefined}
    />,
  );

  assert.equal(markup.match(/aria-label="Keyboard shortcut for/g)?.length, 7);
  assert.equal(markup.match(/aria-label="MIDI shortcut for/g)?.length, 7);
  assert.equal(markup.match(/>Not assigned<\/button>/g)?.length, 7);
  assert.match(markup, />Space<\/button>/);
  assert.match(markup, />Right Arrow<\/button>/);
  assert.match(markup, />1 MIDI input connected</);
  assert.match(markup, /Bluetooth MIDI bridge/);
});
