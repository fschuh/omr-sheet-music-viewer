import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  DEFAULT_KEYBOARD_VIEW_SETTINGS,
  MAX_BLACK_KEY_WIDTH,
  MAX_TILT,
  MAX_TIME_ZOOM,
  MAX_WHITE_KEYS,
  MIN_BLACK_KEY_WIDTH,
  MIN_TILT,
  MIN_TIME_ZOOM,
  MIN_WHITE_KEYS,
  UPCOMING_LEADS,
  type HighwayNoteStyle,
  type HighwayTimeScale,
  type WhiteNoteWidth,
  type KeyboardRangeMode,
  type KeyboardViewSettings,
  type UpcomingKeyEffect,
} from "./keyboardView";
import { playbackCommandNames, type PlaybackCommand } from "./playback";
import { PIANO_IDS, PIANO_REGISTRY, type PianoId } from "./pianoRegistry";
import {
  DEFAULT_REALTIME_COUNT_IN,
  REALTIME_COUNT_IN_SECONDS,
  REALTIME_COUNT_INS,
  type RealtimeCountIn,
} from "./realtime";
import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  LISTEN_MATCHER_PROFILE_IDS,
  LISTEN_MATCHER_PROFILES,
} from "@fschuh/piano-transcription-engine";
import type {
  ListenInputSource,
  ListenMatcherProfileId,
} from "@fschuh/piano-transcription-engine";
import {
  defaultPlaybackShortcuts,
  formatKeyboardShortcut,
  formatMidiShortcut,
  keyboardShortcutFromEvent,
  keyboardShortcutsEqual,
  playbackCommandDetails,
  type PlaybackShortcuts,
} from "./shortcuts";

/**
 * What each registry profile is, as the measured evidence describes it.
 *
 * These strings are presentation only: nothing here selects a profile or feeds a
 * threshold. They exist so the picker cannot present a profile the automated
 * gate rejected as if it were an ordinary choice. The source of truth is the
 * benchmark history in `tools/online_amt/LISTEN_BENCHMARK.md`, and this map has
 * to be revisited whenever a new confirmation run changes a verdict.
 */
const LISTEN_MATCHER_PROFILE_STATUS: Readonly<
  Record<ListenMatcherProfileId, { label: string; detail: string; rejected: boolean }>
> = Object.freeze({
  "baseline-v1": {
    label: "Production default",
    detail: "The profile listen mode ships with. Advances no dedicated safety fixture.",
    rejected: false,
  },
  "balanced-v1": {
    label: "First-generation reference",
    detail: "Selected by the original Direct-only sweep. Never measured on the isolated " +
      "confirmation corpus, so its safety on omitted-bass fixtures is unknown.",
    rejected: false,
  },
  "sensitive-v1": {
    label: "First-generation reference",
    detail: "Same thresholds as early-open-v2, which the August 21 confirmation rejected.",
    rejected: true,
  },
  "early-open-v2": {
    label: "Rejected by automated confirmation",
    detail: "Advances an omitted-bass fixture under both renderers; Tone Course Clear 50/54, " +
      "below the 52/54 floor.",
    rejected: true,
  },
  "steady-open-v2": {
    label: "Rejected by automated confirmation",
    detail: "Advances an omitted-bass fixture under both renderers; Tone Course Clear 50/54, " +
      "below the 52/54 floor.",
    rejected: true,
  },
  "early-held-v2": {
    label: "Rejected by automated confirmation",
    detail: "Advances an omitted-bass fixture under both renderers; Tone 100/106 and 48/54, " +
      "below both isolated floors.",
    rejected: true,
  },
  "steady-held-v2": {
    label: "Rejected by automated confirmation",
    detail: "Advances an omitted-bass fixture under both renderers; Tone 100/106 and 48/54, " +
      "below both isolated floors.",
    rejected: true,
  },
});

function formatListenMatcherThresholds(profileId: ListenMatcherProfileId): string {
  const profile = LISTEN_MATCHER_PROFILES[profileId];
  return `onset ${profile.onsetThreshold} · target ${profile.targetNoteThreshold} · ` +
    `active ${profile.activeTargetThreshold} · unexpected ${profile.extraNoteThreshold}`;
}

const KEYBOARD_RANGE_LABELS: Readonly<Record<KeyboardRangeMode, string>> = {
  full: "All 88 keys",
  song: "The score's range",
  "practiced-hand": "The practised hand's range",
};

const UPCOMING_EFFECT_LABELS: Readonly<Record<UpcomingKeyEffect, string>> = {
  off: "Off",
  "top-edge": "Coloured top edge",
  tint: "Even tint",
  "growing-tint": "Tint that grows as the note nears",
  "filling-meter": "Fills up as the note nears",
};

const UPCOMING_LEAD_LABELS: Readonly<Record<number, string>> = {
  0.125: "Its last eighth",
  0.25: "Its last quarter",
  0.5: "Its last half",
  1: "The whole highway",
};

const NOTE_STYLE_LABELS: Readonly<Record<HighwayNoteStyle, string>> = {
  raised: "Raised blocks",
  flat: "Flat tiles",
};

const WHITE_NOTE_WIDTH_LABELS: Readonly<Record<WhiteNoteWidth, string>> = {
  track: "As wide as their track",
  "whole-key": "As wide as the whole key",
};

const TIME_SCALE_LABELS: Readonly<Record<HighwayTimeScale, string>> = {
  "steady-speed": "Steady speed, notes resize",
  "fixed-tempo": "Fixed tempo, notes keep their size",
};

const COUNT_IN_LABELS: Readonly<Record<RealtimeCountIn, string>> = {
  none: "None",
  short: `Short, about ${REALTIME_COUNT_IN_SECONDS.short} s (default)`,
  long: `Long, about ${REALTIME_COUNT_IN_SECONDS.long} s`,
};

const SETTINGS_SECTIONS = [
  { id: "playback", label: "Playback", hint: "Piano, listen input and loop" },
  { id: "keyboard", label: "Keyboard & highway", hint: "Keys, hand colours and 3D notes" },
  { id: "shortcuts", label: "Shortcuts", hint: "Keyboard keys and MIDI" },
  { id: "repairs", label: "Repairs", hint: "Corrections to recognition" },
  { id: "debug", label: "Debug", hint: "Troubleshooting tools" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface SettingsPageProps {
  /** The section shown first. */
  initialSection?: SettingsSectionId;
  shortcuts: PlaybackShortcuts;
  playbackPiano: PianoId;
  listenInputSource: ListenInputSource;
  /** Whether loop mode dims the bars outside the loop. */
  loopDimOutside?: boolean;
  /** How long realtime counts in before the first note of the score or loop. */
  realtimeCountIn?: RealtimeCountIn;
  keyboardView?: KeyboardViewSettings;
  debugPanelEnabled: boolean;
  sharedNoteheadTimingRepair: boolean;
  timeSignatureRepair: boolean;
  tupletRepair: boolean;
  listenMatcherProfileOverride: ListenMatcherProfileId | null;
  nativeAvailable: boolean;
  midiPorts: string[];
  midiError: string | null;
  midiRefreshing: boolean;
  midiCaptureCommand: PlaybackCommand | null;
  onChangeShortcuts: (shortcuts: PlaybackShortcuts) => void;
  onChangePlaybackPiano: (pianoId: PianoId) => void;
  onChangeListenInputSource: (inputSource: ListenInputSource) => void;
  onChangeLoopDimOutside?: (enabled: boolean) => void;
  onChangeRealtimeCountIn?: (countIn: RealtimeCountIn) => void;
  onChangeKeyboardView?: (settings: KeyboardViewSettings) => void;
  onChangeDebugPanelEnabled: (enabled: boolean) => void;
  onChangeSharedNoteheadTimingRepair: (enabled: boolean) => void;
  onChangeTimeSignatureRepair: (enabled: boolean) => void;
  onChangeTupletRepair: (enabled: boolean) => void;
  onChangeListenMatcherProfileOverride: (profileId: ListenMatcherProfileId | null) => void;
  onBeginMidiCapture: (command: PlaybackCommand) => void;
  onCancelMidiCapture: () => void;
  onRefreshMidiInputs: () => void;
  showStopPlayback?: boolean;
}

export function SettingsPage({
  initialSection = "playback",
  shortcuts,
  playbackPiano,
  listenInputSource,
  loopDimOutside = true,
  realtimeCountIn = DEFAULT_REALTIME_COUNT_IN,
  keyboardView = DEFAULT_KEYBOARD_VIEW_SETTINGS,
  debugPanelEnabled,
  sharedNoteheadTimingRepair,
  timeSignatureRepair,
  tupletRepair,
  listenMatcherProfileOverride,
  nativeAvailable,
  midiPorts,
  midiError,
  midiRefreshing,
  midiCaptureCommand,
  onChangeShortcuts,
  onChangePlaybackPiano,
  onChangeListenInputSource,
  onChangeLoopDimOutside,
  onChangeRealtimeCountIn,
  onChangeKeyboardView,
  onChangeDebugPanelEnabled,
  onChangeSharedNoteheadTimingRepair,
  onChangeTimeSignatureRepair,
  onChangeTupletRepair,
  onChangeListenMatcherProfileOverride,
  onBeginMidiCapture,
  onCancelMidiCapture,
  onRefreshMidiInputs,
  showStopPlayback = false,
}: SettingsPageProps) {
  const [keyboardCaptureCommand, setKeyboardCaptureCommand] = useState<PlaybackCommand | null>(null);
  const [keyboardError, setKeyboardError] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const sectionTabs = useRef(new Map<SettingsSectionId, HTMLButtonElement>());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === "Escape" && (keyboardCaptureCommand || midiCaptureCommand)) {
        event.preventDefault();
        event.stopPropagation();
        setKeyboardCaptureCommand(null);
        setKeyboardError(null);
        onCancelMidiCapture();
        return;
      }
      if (!keyboardCaptureCommand) return;
      event.preventDefault();
      event.stopPropagation();
      const nextShortcut = keyboardShortcutFromEvent(event);
      if (!nextShortcut) return;
      const conflict = playbackCommandNames.find((command) => (
        command !== keyboardCaptureCommand &&
        keyboardShortcutsEqual(shortcuts[command].keyboard, nextShortcut)
      ));
      if (conflict) {
        const conflictLabel = playbackCommandDetails.find((item) => item.command === conflict)?.label ?? conflict;
        setKeyboardError(`${formatKeyboardShortcut(nextShortcut)} is already assigned to ${conflictLabel}.`);
        return;
      }
      onChangeShortcuts({
        ...shortcuts,
        [keyboardCaptureCommand]: {
          ...shortcuts[keyboardCaptureCommand],
          keyboard: nextShortcut,
        },
      });
      setKeyboardCaptureCommand(null);
      setKeyboardError(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyboardCaptureCommand, midiCaptureCommand, onCancelMidiCapture, onChangeShortcuts, shortcuts]);

  function beginKeyboardCapture(command: PlaybackCommand) {
    onCancelMidiCapture();
    setKeyboardCaptureCommand(command);
    setKeyboardError(null);
  }

  function beginMidiCapture(command: PlaybackCommand) {
    setKeyboardCaptureCommand(null);
    setKeyboardError(null);
    onBeginMidiCapture(command);
  }

  function showSection(next: SettingsSectionId) {
    if (next === section) return;
    // A key or MIDI message being learned belongs to the section left behind.
    setKeyboardCaptureCommand(null);
    setKeyboardError(null);
    onCancelMidiCapture();
    setSection(next);
  }

  /** Up and Down move through the sections, Home and End go to the first and last. */
  function moveBetweenSections(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = SETTINGS_SECTIONS.findIndex(({ id }) => id === section);
    const last = SETTINGS_SECTIONS.length - 1;
    const target = event.key === "ArrowDown" ? (index + 1) % SETTINGS_SECTIONS.length
      : event.key === "ArrowUp" ? (index + last) % SETTINGS_SECTIONS.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    const next = SETTINGS_SECTIONS[target].id;
    showSection(next);
    sectionTabs.current.get(next)?.focus();
  }

  function sectionPanel(id: SettingsSectionId) {
    return {
      id: `settings-panel-${id}`,
      role: "tabpanel",
      hidden: section !== id,
    } as const;
  }

  function changeKeyboardView(change: Partial<KeyboardViewSettings>) {
    onChangeKeyboardView?.({ ...keyboardView, ...change });
  }

  const keyboardViewLocked = !onChangeKeyboardView;

  function clearMidi(command: PlaybackCommand) {
    if (midiCaptureCommand === command) onCancelMidiCapture();
    onChangeShortcuts({
      ...shortcuts,
      [command]: { ...shortcuts[command], midi: null },
    });
  }

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-heading">
        <span className="settings-kicker">Preferences</span>
        <h2 id="settings-title">Settings</h2>
        <p>Customize playback controls and optional diagnostics.</p>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map(({ id, label, hint }) => (
              <button
                key={id}
                ref={(element) => {
                  if (element) sectionTabs.current.set(id, element);
                  else sectionTabs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                className={`settings-nav-item${section === id ? " selected" : ""}`}
                aria-selected={section === id}
                aria-controls={`settings-panel-${id}`}
                tabIndex={section === id ? 0 : -1}
                onClick={() => showSection(id)}
                onKeyDown={moveBetweenSections}
              >
                <strong>{label}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </div>
        </nav>

        <div className="settings-content">
          <section className="settings-card" aria-labelledby="playback-piano-title" {...sectionPanel("playback")}>
            <header className="settings-card-header">
              <div>
                <h3 id="playback-piano-title">Playback</h3>
                <p>Select the recorded piano used for score playback and note audition.</p>
              </div>
            </header>
            <label className="settings-select-row">
              <span>
                <strong>Playback piano</strong>
                <small>MusicXML without a dynamic marking uses mezzo-piano (mp).</small>
              </span>
              <select
                aria-label="Playback piano"
                value={playbackPiano}
                onChange={(event) => onChangePlaybackPiano(event.target.value as PianoId)}
              >
                {PIANO_IDS.map((pianoId) => (
                  <option key={pianoId} value={pianoId}>{PIANO_REGISTRY[pianoId].displayName}</option>
                ))}
              </select>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Listen input</strong>
                <small>
                  MIDI uses Note On/Off messages from every connected input. While MIDI listen mode
                  is active, note messages play the score; other MIDI shortcut messages continue to
                  work.
                </small>
              </span>
              <select
                aria-label="Listen input"
                value={listenInputSource}
                onChange={(event) => (
                  onChangeListenInputSource(event.target.value as ListenInputSource)
                )}
              >
                <option value="microphone">Microphone (default)</option>
                <option value="midi" disabled={!nativeAvailable}>MIDI keyboard</option>
              </select>
            </label>
            {onChangeRealtimeCountIn ? (
              <label className="settings-select-row">
                <span>
                  <strong>Count-in</strong>
                  <small>
                    Silence before the first note when realtime playback starts at the top of the
                    score or the loop: playing with no note selected, or after a rewind, while the
                    playhead moves from the barline to the first note. It counts whole beats of
                    the time signature, as many as come nearest the time chosen at the tempo
                    playing, so a slow tempo counts fewer beats and a fast one more. Rests the
                    music opens with count toward it. A selected note plays at once, and a loop
                    starting over plays straight on.
                  </small>
                </span>
                <select
                  aria-label="Count-in"
                  value={realtimeCountIn}
                  onChange={(event) => onChangeRealtimeCountIn(event.target.value as RealtimeCountIn)}
                >
                  {REALTIME_COUNT_INS.map((countIn) => (
                    <option key={countIn} value={countIn}>{COUNT_IN_LABELS[countIn]}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {onChangeLoopDimOutside ? (
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  aria-label="Dim bars outside the loop"
                  checked={loopDimOutside}
                  onChange={(event) => onChangeLoopDimOutside(event.target.checked)}
                />
                <span>
                  <strong>Dim bars outside the loop</strong>
                  <small>While loop mode is on, the bars it does not play are faded on the score.</small>
                </span>
              </label>
            ) : null}
          </section>

          <section className="settings-card" aria-labelledby="keyboard-view-title" {...sectionPanel("keyboard")}>
            <header className="settings-card-header">
              <div>
                <h3 id="keyboard-view-title">Keyboard &amp; highway</h3>
                <p>
                  How the keyboard shown during playback and the 3D note highway above it look.
                  Changes show straight away.
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={keyboardViewLocked}
                onClick={() => onChangeKeyboardView?.({ ...DEFAULT_KEYBOARD_VIEW_SETTINGS })}
              >
                Reset defaults
              </button>
            </header>

            <h4 className="settings-group-title">Keys</h4>
            <label className="settings-select-row">
              <span>
                <strong>Keys shown</strong>
                <small>
                  Fewer keys make each one wider. A range spans the lowest to the highest note of
                  the whole score, or of the hand being practised, with a key to spare at each end.
                </small>
              </span>
              <select
                aria-label="Keys shown"
                value={keyboardView.range}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ range: event.target.value as KeyboardRangeMode })}
              >
                {(Object.keys(KEYBOARD_RANGE_LABELS) as KeyboardRangeMode[]).map((mode) => (
                  <option key={mode} value={mode}>{KEYBOARD_RANGE_LABELS[mode]}</option>
                ))}
              </select>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Narrowest range</strong>
                <small>A range is widened to at least this many white keys.</small>
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  aria-label="Narrowest range"
                  min={MIN_WHITE_KEYS}
                  max={MAX_WHITE_KEYS}
                  step={1}
                  value={keyboardView.minimumWhiteKeys}
                  disabled={keyboardViewLocked || keyboardView.range === "full"}
                  onChange={(event) => changeKeyboardView({ minimumWhiteKeys: Number(event.target.value) })}
                />
                <output>{keyboardView.minimumWhiteKeys} white keys</output>
              </span>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Black key width</strong>
                <small>
                  Thinner or thicker black keys, next to the white ones. 100% is a real
                  piano&apos;s, about three fifths of a white key. The highway&apos;s tracks follow.
                </small>
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  aria-label="Black key width"
                  min={MIN_BLACK_KEY_WIDTH}
                  max={MAX_BLACK_KEY_WIDTH}
                  step={0.05}
                  value={keyboardView.blackKeyWidth}
                  disabled={keyboardViewLocked}
                  onChange={(event) => changeKeyboardView({ blackKeyWidth: Number(event.target.value) })}
                />
                <output>{Math.round(keyboardView.blackKeyWidth * 100)}%</output>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Name every C"
                checked={keyboardView.octaveLabels}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ octaveLabels: event.target.checked })}
              />
              <span>
                <strong>Name every C</strong>
                <small>C1, C2… on their keys, so you can find an octave at a glance. Middle C is C4.</small>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Finger numbers on played keys"
                checked={keyboardView.fingerNumbers}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ fingerNumbers: event.target.checked })}
              />
              <span>
                <strong>Finger numbers on played keys</strong>
                <small>A circle in the hand&apos;s colour with the finger to play the key with, where fingering is known.</small>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Note names on played keys"
                checked={keyboardView.noteNames}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ noteNames: event.target.checked })}
              />
              <span>
                <strong>Note names on played keys</strong>
                <small>The name of each note being played, such as C♯4, on its key.</small>
              </span>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Upcoming keys</strong>
                <small>
                  With the 3D note highway on, how a key shows that its next note is on the way, in
                  that note&apos;s hand colour.
                </small>
              </span>
              <select
                aria-label="Upcoming keys"
                value={keyboardView.upcomingEffect}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ upcomingEffect: event.target.value as UpcomingKeyEffect })}
              >
                {(Object.keys(UPCOMING_EFFECT_LABELS) as UpcomingKeyEffect[]).map((effect) => (
                  <option key={effect} value={effect}>{UPCOMING_EFFECT_LABELS[effect]}</option>
                ))}
              </select>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Show upcoming keys over</strong>
                <small>
                  How much of the highway, from the keys up, a note is shown on its key for. A
                  quarter is about 0.8 seconds in realtime and two steps note by note.
                </small>
              </span>
              <select
                aria-label="Show upcoming keys over"
                value={keyboardView.upcomingLead}
                disabled={keyboardViewLocked || keyboardView.upcomingEffect === "off"}
                onChange={(event) => changeKeyboardView({ upcomingLead: Number(event.target.value) })}
              >
                {UPCOMING_LEADS.map((lead) => (
                  <option key={lead} value={lead}>{UPCOMING_LEAD_LABELS[lead]}</option>
                ))}
              </select>
            </label>

            <h4 className="settings-group-title">Hands</h4>
            <div className="settings-select-row">
              <span>
                <strong>Hand colours</strong>
                <small>
                  Played keys, finger numbers and notes on the highway take their hand&apos;s
                  colour; on black keys a darker shade of it.
                </small>
              </span>
              <span className="settings-color-controls">
                <label>
                  <input
                    type="color"
                    aria-label="Right hand colour"
                    value={keyboardView.rightHandColor}
                    disabled={keyboardViewLocked}
                    onChange={(event) => changeKeyboardView({ rightHandColor: event.target.value })}
                  />
                  <span>Right</span>
                </label>
                <label>
                  <input
                    type="color"
                    aria-label="Left hand colour"
                    value={keyboardView.leftHandColor}
                    disabled={keyboardViewLocked}
                    onChange={(event) => changeKeyboardView({ leftHandColor: event.target.value })}
                  />
                  <span>Left</span>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={keyboardViewLocked || (
                    keyboardView.rightHandColor === DEFAULT_KEYBOARD_VIEW_SETTINGS.rightHandColor &&
                    keyboardView.leftHandColor === DEFAULT_KEYBOARD_VIEW_SETTINGS.leftHandColor
                  )}
                  onClick={() => changeKeyboardView({
                    rightHandColor: DEFAULT_KEYBOARD_VIEW_SETTINGS.rightHandColor,
                    leftHandColor: DEFAULT_KEYBOARD_VIEW_SETTINGS.leftHandColor,
                  })}
                >
                  Reset colours
                </button>
              </span>
            </div>

            <h4 className="settings-group-title">3D note highway</h4>
            <label className="settings-select-row">
              <span>
                <strong>Tilt</strong>
                <small>How far the highway leans back. 0° looks straight down at it.</small>
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  aria-label="Highway tilt"
                  min={MIN_TILT}
                  max={MAX_TILT}
                  step={1}
                  value={keyboardView.tilt}
                  disabled={keyboardViewLocked}
                  onChange={(event) => changeKeyboardView({ tilt: Number(event.target.value) })}
                />
                <output>{keyboardView.tilt}°</output>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="3D keyboard"
                checked={keyboardView.keyboard3d}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ keyboard3d: event.target.checked })}
              />
              <span>
                <strong>3D keyboard</strong>
                <small>
                  While the highway is shown, the keys lie on its floor and lean back with it, with
                  raised black keys, instead of standing flat below it.
                </small>
              </span>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Notes</strong>
                <small>
                  Blocks with a little height, or flat tiles on the highway&apos;s floor. Notes on
                  black keys are narrower and darker either way.
                </small>
              </span>
              <select
                aria-label="Highway notes"
                value={keyboardView.noteStyle}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ noteStyle: event.target.value as HighwayNoteStyle })}
              >
                {(Object.keys(NOTE_STYLE_LABELS) as HighwayNoteStyle[]).map((style) => (
                  <option key={style} value={style}>{NOTE_STYLE_LABELS[style]}</option>
                ))}
              </select>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>White-key notes</strong>
                <small>
                  As wide as their track, the back of the key between the black keys, so every
                  note is about as wide; or as wide as the whole key, reaching under the black
                  keys&apos; tracks beside it, so white-key notes stand out from black-key ones.
                </small>
              </span>
              <select
                aria-label="White-key note width"
                value={keyboardView.whiteNoteWidth}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ whiteNoteWidth: event.target.value as WhiteNoteWidth })}
              >
                {(Object.keys(WHITE_NOTE_WIDTH_LABELS) as WhiteNoteWidth[]).map((width) => (
                  <option key={width} value={width}>{WHITE_NOTE_WIDTH_LABELS[width]}</option>
                ))}
              </select>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>Time zoom</strong>
                <small>
                  Stretches the notes along the highway. Higher shows less time ahead, with
                  longer notes further apart; lower shows more of what is coming.
                </small>
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  aria-label="Highway time zoom"
                  min={MIN_TIME_ZOOM}
                  max={MAX_TIME_ZOOM}
                  step={0.1}
                  value={keyboardView.timeZoom}
                  disabled={keyboardViewLocked}
                  onChange={(event) => changeKeyboardView({ timeZoom: Number(event.target.value) })}
                />
                <output>{keyboardView.timeZoom.toFixed(1)}×</output>
              </span>
            </label>
            <label className="settings-select-row">
              <span>
                <strong>When the tempo changes</strong>
                <small>
                  Steady speed: notes take the same time to reach the keys at any tempo, so a
                  faster tempo packs them closer and shorter. Fixed tempo: every beat keeps the
                  length it has at the score&apos;s opening tempo, and the notes come down faster
                  or slower instead. Applies to realtime playback.
                </small>
              </span>
              <select
                aria-label="Highway time scale"
                value={keyboardView.timeScale}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ timeScale: event.target.value as HighwayTimeScale })}
              >
                {(Object.keys(TIME_SCALE_LABELS) as HighwayTimeScale[]).map((scale) => (
                  <option key={scale} value={scale}>{TIME_SCALE_LABELS[scale]}</option>
                ))}
              </select>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Finger numbers on highway notes"
                checked={keyboardView.highwayFingerNumbers}
                disabled={keyboardViewLocked}
                onChange={(event) => changeKeyboardView({ highwayFingerNumbers: event.target.checked })}
              />
              <span>
                <strong>Finger numbers on notes</strong>
                <small>The finger to play each note with, at its front end, where fingering is known and the note is long enough.</small>
              </span>
            </label>
          </section>

          <section className="settings-card" aria-labelledby="shortcuts-title" {...sectionPanel("shortcuts")}>
            <header className="settings-card-header">
              <div>
                <h3 id="shortcuts-title">Shortcuts</h3>
                <p>Select a shortcut to replace it. MIDI assignments accept channel voice messages from any connected input and any channel. Hold Note or Control Change inputs to repeat navigation commands.</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setKeyboardCaptureCommand(null);
                  onCancelMidiCapture();
                  setKeyboardError(null);
                  onChangeShortcuts(defaultPlaybackShortcuts());
                }}
              >
                Reset defaults
              </button>
            </header>

            <div className="midi-status" aria-live="polite">
              <span className={`midi-status-dot${midiError ? " unavailable" : midiPorts.length ? " connected" : ""}`} />
              <div>
                <strong>
                  {!nativeAvailable
                    ? "MIDI is available in the desktop app"
                    : midiRefreshing
                      ? "Looking for MIDI inputs…"
                      : midiError
                        ? "MIDI unavailable"
                        : midiPorts.length
                          ? `${midiPorts.length} MIDI input${midiPorts.length === 1 ? "" : "s"} connected`
                          : "No MIDI inputs found"}
                </strong>
                <span>{midiError ?? (midiPorts.length ? midiPorts.join(" · ") : "Connect or start your Windows MIDI bridge, then scan again.")}</span>
              </div>
              <button type="button" disabled={!nativeAvailable || midiRefreshing} onClick={onRefreshMidiInputs}>
                Scan again
              </button>
            </div>

            {(keyboardCaptureCommand || midiCaptureCommand) ? (
              <div className="capture-banner" role="status">
                <span className="capture-pulse" />
                {keyboardCaptureCommand ? "Press the new key combination" : "Press a button on your MIDI page turner"}
                <kbd>Esc</kbd><span>to cancel</span>
              </div>
            ) : null}
            {keyboardError ? <div className="shortcut-error" role="alert">{keyboardError}</div> : null}

            <div className="shortcuts-table" role="table" aria-label="Playback shortcut assignments">
              <div className="shortcuts-row shortcuts-header" role="row">
                <span role="columnheader">Playback command</span>
                <span role="columnheader">Keyboard</span>
                <span role="columnheader">MIDI message</span>
              </div>
              {playbackCommandDetails
                .filter(({ command }) => showStopPlayback || command !== "stopPlayback")
                .map(({ command, label, description }) => {
                const learningKeyboard = keyboardCaptureCommand === command;
                const learningMidi = midiCaptureCommand === command;
                const midi = shortcuts[command].midi;
                return (
                  <div className="shortcuts-row" role="row" key={command}>
                    <div className="shortcut-command" role="cell">
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <div role="cell">
                      <button
                        type="button"
                        className={`shortcut-binding${learningKeyboard ? " listening" : ""}`}
                        aria-label={`Keyboard shortcut for ${label}`}
                        aria-pressed={learningKeyboard}
                        onClick={() => beginKeyboardCapture(command)}
                      >
                        {learningKeyboard ? "Press keys…" : formatKeyboardShortcut(shortcuts[command].keyboard)}
                      </button>
                    </div>
                    <div className="midi-binding-cell" role="cell">
                      <button
                        type="button"
                        className={`shortcut-binding midi-binding${learningMidi ? " listening" : ""}${midi ? " assigned" : ""}`}
                        aria-label={`MIDI shortcut for ${label}`}
                        aria-pressed={learningMidi}
                        disabled={!nativeAvailable || midiRefreshing || Boolean(midiError)}
                        onClick={() => beginMidiCapture(command)}
                      >
                        {learningMidi ? "Waiting for MIDI…" : midi ? formatMidiShortcut(midi) : "Not assigned"}
                      </button>
                      {midi ? (
                        <button type="button" className="clear-binding" aria-label={`Clear MIDI shortcut for ${label}`} onClick={() => clearMidi(command)}>×</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-card" aria-labelledby="repairs-title" {...sectionPanel("repairs")}>
            <header className="settings-card-header">
              <div>
                <h3 id="repairs-title">Repairs</h3>
                <p>
                  Corrections made while a score is recognized, where the page shows what the
                  recognizer missed. After a change, a score is recognized again the next time
                  it is opened.
                </p>
              </div>
            </header>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Note timing at shared noteheads"
                checked={sharedNoteheadTimingRepair}
                onChange={(event) => onChangeSharedNoteheadTimingRepair(event.target.checked)}
              />
              <span>
                <strong>Note timing at shared noteheads</strong>
                <small>
                  Where two voices share one notehead, such as an eighth note on the first note
                  of a 16th run, the notes after it start when the shorter note ends, as printed.
                  Only applied where the bar then adds up to its time signature.
                </small>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Time signatures from the page"
                checked={timeSignatureRepair}
                onChange={(event) => onChangeTimeSignatureRepair(event.target.checked)}
              />
              <span>
                <strong>Time signatures from the page</strong>
                <small>
                  Writes the time signature printed on the page instead of guessing it from the
                  bar lengths, which misread notes throw off, and carries it from page to page
                  where it is not printed again. A time signature the recognizer sees where none
                  is printed is left out.
                </small>
              </span>
            </label>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                aria-label="Tuplets from beams and brackets"
                checked={timeSignatureRepair && tupletRepair}
                disabled={!timeSignatureRepair}
                onChange={(event) => onChangeTupletRepair(event.target.checked)}
              />
              <span>
                <strong>Tuplets from beams and brackets</strong>
                <small>
                  Writes notes read as plain values as a triplet where a beam or a bracketed
                  number on the page shows one, such as three eighths under one beam in a beat.
                  Only applied where the bar then adds up to its time signature, so it needs the
                  time signatures from the page.
                </small>
              </span>
            </label>
          </section>

          <section className="settings-card" aria-labelledby="debug-title" {...sectionPanel("debug")}>
            <header className="settings-card-header">
              <div>
                <h3 id="debug-title">Debug</h3>
                <p>Show troubleshooting tools and recognition details alongside the score.</p>
              </div>
            </header>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={debugPanelEnabled}
                onChange={(event) => onChangeDebugPanelEnabled(event.target.checked)}
              />
              <span>
                <strong>Enable debug panel</strong>
                <small>Displays the right-side panel with note highlighting, overlays, diagnostics, and document data.</small>
              </span>
            </label>
            {debugPanelEnabled ? (
              <fieldset className="settings-profile-override">
                <legend>Listen matcher profile</legend>
                <p className="settings-profile-note">
                  Overrides the profile listen mode runs with, for this session only. It is not
                  saved, and it is cleared when the debug panel is switched off. Timing and
                  advancement rules are the same for every profile; only confidence thresholds
                  change.
                </p>
                <label className="settings-profile-row">
                  <input
                    type="radio"
                    name="listen-matcher-profile"
                    value=""
                    checked={listenMatcherProfileOverride === null}
                    onChange={() => onChangeListenMatcherProfileOverride(null)}
                  />
                  <span>
                    <strong>No override</strong>
                    <small>Use the production default ({DEFAULT_LISTEN_MATCHER_PROFILE_ID}).</small>
                  </span>
                </label>
                {LISTEN_MATCHER_PROFILE_IDS.map((profileId) => {
                  const status = LISTEN_MATCHER_PROFILE_STATUS[profileId];
                  return (
                    <label
                      key={profileId}
                      className={status.rejected
                        ? "settings-profile-row settings-profile-rejected"
                        : "settings-profile-row"}
                    >
                      <input
                        type="radio"
                        name="listen-matcher-profile"
                        value={profileId}
                        checked={listenMatcherProfileOverride === profileId}
                        onChange={() => onChangeListenMatcherProfileOverride(profileId)}
                      />
                      <span>
                        <strong>
                          {profileId}
                          {status.rejected ? " ⚠" : ""}
                        </strong>
                        <small>{status.label} — {status.detail}</small>
                        <small className="settings-profile-thresholds">
                          {formatListenMatcherThresholds(profileId)}
                        </small>
                      </span>
                    </label>
                  );
                })}
                <p className="settings-profile-note">
                  Selecting a profile stops listen mode and rebuilds the matcher, so a passage in
                  progress is never judged by two profiles at once.
                </p>
              </fieldset>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
