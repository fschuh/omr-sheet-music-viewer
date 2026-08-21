import { useEffect, useState } from "react";
import { playbackCommandNames, type PlaybackCommand } from "./playback";
import { PIANO_IDS, PIANO_REGISTRY, type PianoId } from "./pianoRegistry";
import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  LISTEN_MATCHER_PROFILE_IDS,
  LISTEN_MATCHER_PROFILES,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
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

interface SettingsPageProps {
  shortcuts: PlaybackShortcuts;
  playbackPiano: PianoId;
  debugPanelEnabled: boolean;
  listenMatcherProfileOverride: ListenMatcherProfileId | null;
  nativeAvailable: boolean;
  midiPorts: string[];
  midiError: string | null;
  midiRefreshing: boolean;
  midiCaptureCommand: PlaybackCommand | null;
  onChangeShortcuts: (shortcuts: PlaybackShortcuts) => void;
  onChangePlaybackPiano: (pianoId: PianoId) => void;
  onChangeDebugPanelEnabled: (enabled: boolean) => void;
  onChangeListenMatcherProfileOverride: (profileId: ListenMatcherProfileId | null) => void;
  onBeginMidiCapture: (command: PlaybackCommand) => void;
  onCancelMidiCapture: () => void;
  onRefreshMidiInputs: () => void;
  showStopPlayback?: boolean;
}

export function SettingsPage({
  shortcuts,
  playbackPiano,
  debugPanelEnabled,
  listenMatcherProfileOverride,
  nativeAvailable,
  midiPorts,
  midiError,
  midiRefreshing,
  midiCaptureCommand,
  onChangeShortcuts,
  onChangePlaybackPiano,
  onChangeDebugPanelEnabled,
  onChangeListenMatcherProfileOverride,
  onBeginMidiCapture,
  onCancelMidiCapture,
  onRefreshMidiInputs,
  showStopPlayback = false,
}: SettingsPageProps) {
  const [keyboardCaptureCommand, setKeyboardCaptureCommand] = useState<PlaybackCommand | null>(null);
  const [keyboardError, setKeyboardError] = useState<string | null>(null);

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

      <section className="settings-card" aria-labelledby="playback-piano-title">
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
      </section>

      <section className="settings-card" aria-labelledby="shortcuts-title">
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

      <section className="settings-card" aria-labelledby="debug-title">
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
    </section>
  );
}
