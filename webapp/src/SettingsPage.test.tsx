import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPage } from "./SettingsPage";
import { defaultPlaybackShortcuts } from "./shortcuts";
import { LISTEN_MATCHER_PROFILE_IDS } from "./listenMatcherProfiles";
import {
  LISTEN_INPUT_SOURCE_STORAGE_KEY,
  loadListenInputSource,
  saveListenInputSource,
} from "./preferences";

test("renders every playback command with its default keyboard key and empty MIDI slot", () => {
  const markup = renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      playbackPiano="splendid"
      listenInputSource="microphone"
      debugPanelEnabled={false}
      listenMatcherProfileOverride={null}
      nativeAvailable
      midiPorts={["Bluetooth MIDI bridge"]}
      midiError={null}
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onChangePlaybackPiano={() => undefined}
      onChangeListenInputSource={() => undefined}
      onChangeDebugPanelEnabled={() => undefined}
      onChangeListenMatcherProfileOverride={() => undefined}
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
  assert.match(markup, /aria-label="Playback piano"/);
  assert.match(markup, /aria-label="Listen input"/);
  assert.match(markup, /Microphone \(default\)<\/option>/);
  assert.match(markup, /MIDI keyboard<\/option>/);
  assert.match(markup, />Splendid Grand Piano<\/option>/);
  assert.match(markup, />Salamander Grand Piano<\/option>/);
  assert.match(markup, />Enable debug panel<\/strong>/);
  assert.doesNotMatch(markup, /type="checkbox" checked=""/);
});

test("disables MIDI assignment when initialization fails", () => {
  const markup = renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      playbackPiano="salamander"
      listenInputSource="midi"
      debugPanelEnabled
      listenMatcherProfileOverride={null}
      nativeAvailable
      midiPorts={[]}
      midiError="MIDI initialization timed out."
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onChangePlaybackPiano={() => undefined}
      onChangeListenInputSource={() => undefined}
      onChangeDebugPanelEnabled={() => undefined}
      onChangeListenMatcherProfileOverride={() => undefined}
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

function renderSettings(
  overrides: Partial<Parameters<typeof SettingsPage>[0]> = {},
): string {
  return renderToStaticMarkup(
    <SettingsPage
      shortcuts={defaultPlaybackShortcuts()}
      playbackPiano="splendid"
      listenInputSource="microphone"
      debugPanelEnabled
      listenMatcherProfileOverride={null}
      nativeAvailable
      midiPorts={[]}
      midiError={null}
      midiRefreshing={false}
      midiCaptureCommand={null}
      onChangeShortcuts={() => undefined}
      onChangePlaybackPiano={() => undefined}
      onChangeListenInputSource={() => undefined}
      onChangeDebugPanelEnabled={() => undefined}
      onChangeListenMatcherProfileOverride={() => undefined}
      onBeginMidiCapture={() => undefined}
      onCancelMidiCapture={() => undefined}
      onRefreshMidiInputs={() => undefined}
      {...overrides}
    />,
  );
}

test("the matcher profile override is hidden until the debug panel is enabled", () => {
  const hidden = renderSettings({ debugPanelEnabled: false });

  assert.doesNotMatch(hidden, /Listen matcher profile/);
  assert.doesNotMatch(hidden, /name="listen-matcher-profile"/);
  assert.match(renderSettings(), /<legend>Listen matcher profile<\/legend>/);
});

test("the override offers every registry profile plus an explicit no-override default", () => {
  const markup = renderSettings();

  assert.equal(markup.match(/name="listen-matcher-profile"/g)?.length, 8);
  for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
    assert.match(markup, new RegExp(`value="${profileId}"`));
  }
  assert.match(markup, /<strong>No override<\/strong>/);
  assert.match(markup, /Use the production default \(baseline-v1\)/);
  // The thresholds are shown because a tester needs to know what the profile
  // changed, but they are text: nothing here can be edited into the matcher.
  assert.match(markup, /onset 0.6 · target 0.5 · active 0.35 · unexpected 0.97/);
});

test("every profile the confirmation run rejected is labelled as rejected", () => {
  const markup = renderSettings();
  const rejected = ["sensitive-v1", "early-open-v2", "steady-open-v2", "early-held-v2", "steady-held-v2"];

  assert.equal(markup.match(/settings-profile-rejected/g)?.length, rejected.length);
  assert.equal(markup.match(/Rejected by automated confirmation/g)?.length, 4);
  assert.match(markup, /Same thresholds as early-open-v2/);
  assert.match(markup, /Never measured on the isolated confirmation corpus/);
  for (const profileId of ["baseline-v1", "balanced-v1"]) {
    const row = markup.slice(markup.indexOf(`value="${profileId}"`));
    assert.doesNotMatch(row.slice(0, row.indexOf("</label>")), /⚠/);
  }
});

test("no override is selected by default, and an active override is the checked row", () => {
  const noOverride = renderSettings();
  const overridden = renderSettings({ listenMatcherProfileOverride: "early-open-v2" });

  // React renders the checked attribute before value, so the checked row is the
  // one carrying both: matching value alone would pass for every row.
  assert.match(noOverride, /checked="" value=""/);
  assert.doesNotMatch(noOverride, /checked="" value="[a-z]/);
  assert.match(overridden, /checked="" value="early-open-v2"/);
  assert.doesNotMatch(overridden, /checked="" value=""/);
  assert.equal(overridden.match(/name="listen-matcher-profile" checked=""/g)?.length, 1);
});

test("listen input defaults to microphone and persists a valid MIDI selection", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
  try {
    assert.equal(loadListenInputSource(), "microphone");
    saveListenInputSource("midi");
    assert.equal(values.get(LISTEN_INPUT_SOURCE_STORAGE_KEY), "midi");
    assert.equal(loadListenInputSource(), "midi");
    values.set(LISTEN_INPUT_SOURCE_STORAGE_KEY, "invalid");
    assert.equal(loadListenInputSource(), "microphone");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
