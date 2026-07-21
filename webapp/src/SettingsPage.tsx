import { useEffect, useState } from "react";
import { playbackCommandNames, type PlaybackCommand } from "./playback";
import {
  defaultPlaybackShortcuts,
  formatKeyboardShortcut,
  formatMidiShortcut,
  keyboardShortcutFromEvent,
  keyboardShortcutsEqual,
  playbackCommandDetails,
  type PlaybackShortcuts,
} from "./shortcuts";

interface SettingsPageProps {
  shortcuts: PlaybackShortcuts;
  debugPanelEnabled: boolean;
  nativeAvailable: boolean;
  midiPorts: string[];
  midiError: string | null;
  midiRefreshing: boolean;
  midiCaptureCommand: PlaybackCommand | null;
  onChangeShortcuts: (shortcuts: PlaybackShortcuts) => void;
  onChangeDebugPanelEnabled: (enabled: boolean) => void;
  onBeginMidiCapture: (command: PlaybackCommand) => void;
  onCancelMidiCapture: () => void;
  onRefreshMidiInputs: () => void;
  showStopPlayback?: boolean;
}

export function SettingsPage({
  shortcuts,
  debugPanelEnabled,
  nativeAvailable,
  midiPorts,
  midiError,
  midiRefreshing,
  midiCaptureCommand,
  onChangeShortcuts,
  onChangeDebugPanelEnabled,
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
      </section>
    </section>
  );
}
