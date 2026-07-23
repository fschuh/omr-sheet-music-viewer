import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPage } from "./SettingsPage";
import { defaultPlaybackShortcuts } from "./shortcuts";

test("renders every playback command with its default keyboard key and empty MIDI slot", () => {
  const markup = renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      debugPanelEnabled={false}
      nativeAvailable
      midiPorts={["Bluetooth MIDI bridge"]}
      midiError={null}
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onChangeDebugPanelEnabled={() => undefined}
      onBeginMidiCapture={() => undefined}
      onCancelMidiCapture={() => undefined}
      onRefreshMidiInputs={() => undefined}
    />,
  );

  assert.equal(markup.match(/aria-label="Keyboard shortcut for/g)?.length, 10);
  assert.equal(markup.match(/aria-label="MIDI shortcut for/g)?.length, 10);
  assert.equal(markup.match(/>Not assigned<\/button>/g)?.length, 10);
  assert.match(markup, />Space<\/button>/);
  assert.match(markup, />M<\/button>/);
  assert.match(markup, />L<\/button>/);
  assert.match(markup, />P<\/button>/);
  assert.match(markup, />Right Arrow<\/button>/);
  assert.match(markup, />1 MIDI input connected</);
  assert.match(markup, /Bluetooth MIDI bridge/);
  assert.match(markup, /<h3 id="debug-title">Debug<\/h3>/);
  assert.match(markup, />Enable debug panel<\/strong>/);
  assert.doesNotMatch(markup, /type="checkbox" checked=""/);
});

test("disables MIDI assignment when initialization fails", () => {
  const markup = renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      debugPanelEnabled
      nativeAvailable
      midiPorts={[]}
      midiError="MIDI initialization timed out."
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onChangeDebugPanelEnabled={() => undefined}
      onBeginMidiCapture={() => undefined}
      onCancelMidiCapture={() => undefined}
      onRefreshMidiInputs={() => undefined}
    />,
  );

  assert.match(markup, />MIDI unavailable</);
  assert.match(markup, /MIDI initialization timed out\./);
  assert.equal(markup.match(/aria-label="MIDI shortcut for[^>]+disabled/g)?.length, 10);
  assert.match(markup, /type="checkbox" checked=""/);
});
