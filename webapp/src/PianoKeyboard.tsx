import { useMemo } from "react";
import { pitchToMidi } from "./piano";

const FIRST_PIANO_MIDI = 21; // A0
const LAST_PIANO_MIDI = 108; // C8
const WHITE_KEY_COUNT = 52;
const BLACK_KEY_WIDTH_IN_WHITE_KEYS = 0.64;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

interface PianoKey {
  midi: number;
  name: string;
  black: boolean;
  whiteIndex: number;
}

interface PianoKeyboardProps {
  notes: readonly PianoKeyboardNote[];
}

export interface PianoKeyboardNote {
  pitch: string;
  finger?: number;
  left?: boolean;
}

interface PianoKeyLabels {
  names: string[];
  fingerings: string[];
}

function pianoKeyName(midi: number): string {
  const pitchClass = midi % 12;
  return `${SHARP_NAMES[pitchClass]}${Math.floor(midi / 12) - 1}`;
}

function buildPianoKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  let whiteIndex = 0;
  for (let midi = FIRST_PIANO_MIDI; midi <= LAST_PIANO_MIDI; midi += 1) {
    const black = BLACK_PITCH_CLASSES.has(midi % 12);
    keys.push({ midi, name: pianoKeyName(midi), black, whiteIndex });
    if (!black) whiteIndex += 1;
  }
  return keys;
}

export const PIANO_KEYS = buildPianoKeys();

export function formatKeyboardPitch(pitch: string): string {
  const normalized = pitch.trim();
  const conventional = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(normalized);
  const trailing = /^([A-Ga-g])(-?\d+)([#b♯♭]+)$/.exec(normalized);
  const match = conventional ?? trailing;
  if (!match) return normalized;
  const accidental = (conventional ? match[2] : match[3])
    .replaceAll("#", "♯")
    .replaceAll("b", "♭");
  const octave = conventional ? match[3] : match[2];
  return `${match[1].toUpperCase()}${accidental}${octave}`;
}

export function PianoKeyboard({ notes }: PianoKeyboardProps) {
  const activeLabels = useMemo(() => {
    const labels = new Map<number, PianoKeyLabels>();
    for (const note of notes) {
      const midi = pitchToMidi(note.pitch);
      if (midi === null || midi < FIRST_PIANO_MIDI || midi > LAST_PIANO_MIDI) continue;
      const label = formatKeyboardPitch(note.pitch);
      const keyLabels = labels.get(midi) ?? { names: [], fingerings: [] };
      if (!keyLabels.names.includes(label)) keyLabels.names.push(label);
      if (note.finger !== undefined) {
        const fingering = `${note.left ? "L" : "R"}${note.finger}`;
        if (!keyLabels.fingerings.includes(fingering)) keyLabels.fingerings.push(fingering);
      }
      labels.set(midi, keyLabels);
    }
    return labels;
  }, [notes]);
  const activePitchNames = Array.from(activeLabels.values()).flatMap((labels) => labels.names);
  const accessibleNotes = Array.from(activeLabels.values()).flatMap((labels) =>
    labels.names.map((name) => {
      const spokenFingerings = labels.fingerings.map((fingering) =>
        `${fingering.startsWith("L") ? "left" : "right"} hand finger ${fingering.slice(1)}`,
      );
      const fingering = spokenFingerings.length > 0
        ? `, ${spokenFingerings.join(" or ")}`
        : "";
      return `${name}${fingering}`;
    }),
  );

  function keyLabel(labels: PianoKeyLabels) {
    return (
      <span className="piano-key-label">
        {labels.fingerings.length > 0 ? (
          <span className="piano-key-fingering">{labels.fingerings.join("/")}</span>
        ) : null}
        <span className="piano-key-note-name">{labels.names.join("/")}</span>
      </span>
    );
  }

  return (
    <section
      className="piano-keyboard-overlay"
      aria-label={`88-key piano keyboard. ${
        activePitchNames.length > 0
          ? `Notes under the playhead: ${accessibleNotes.join("; ")}`
          : "No pitched notes under the playhead"
      }`}
    >
      <header className="piano-keyboard-heading">
        <span className="piano-keyboard-title">Keyboard</span>
        <span className="piano-keyboard-current" aria-live="polite">
          {activePitchNames.length > 0 ? (
            <>
              <span>Under playhead</span>
              {activePitchNames.map((name) => <strong key={name}>{name}</strong>)}
            </>
          ) : (
            <span>No pitched notes under playhead</span>
          )}
        </span>
        <span className="piano-keyboard-range">88 keys · A0–C8</span>
      </header>
      <div className="piano-keys" aria-hidden="true">
        <div className="piano-white-keys">
          {PIANO_KEYS.filter((key) => !key.black).map((key) => {
            const labels = activeLabels.get(key.midi);
            return (
              <div
                key={key.midi}
                className={`piano-key piano-key-white${labels ? " active" : ""}`}
                data-piano-key={key.name}
                data-midi={key.midi}
                data-active={labels ? "true" : undefined}
              >
                {labels ? keyLabel(labels) : null}
              </div>
            );
          })}
        </div>
        <div className="piano-black-keys">
          {PIANO_KEYS.filter((key) => key.black).map((key) => {
            const labels = activeLabels.get(key.midi);
            const width = (BLACK_KEY_WIDTH_IN_WHITE_KEYS / WHITE_KEY_COUNT) * 100;
            const left = ((key.whiteIndex - BLACK_KEY_WIDTH_IN_WHITE_KEYS / 2) / WHITE_KEY_COUNT) * 100;
            return (
              <div
                key={key.midi}
                className={`piano-key piano-key-black${labels ? " active" : ""}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                data-piano-key={key.name}
                data-midi={key.midi}
                data-active={labels ? "true" : undefined}
              >
                {labels ? keyLabel(labels) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
