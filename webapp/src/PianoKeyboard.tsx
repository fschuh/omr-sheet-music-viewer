import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BLACK_KEY_WIDTH_IN_WHITE_KEYS,
  DEFAULT_KEYBOARD_VIEW_SETTINGS,
  FIRST_PIANO_MIDI,
  FULL_KEYBOARD_RANGE,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  pianoKeyName,
  pianoKeyWhiteIndex,
  type KeyboardRange,
  type KeyboardViewSettings,
  type PianoKey,
} from "./keyboardView";
import {
  highwayCamera,
  highwayLayout,
  keyboardSurfaceMatrix,
  NOTE_HIGHWAY_TOP_FRACTION,
  projectSurfacePoint,
} from "./noteHighway/highwayModel";
import { pitchToMidi } from "./piano";

export {
  BLACK_KEY_WIDTH_IN_WHITE_KEYS,
  FIRST_PIANO_MIDI,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  pianoKeyWhiteIndex,
  WHITE_KEY_COUNT,
} from "./keyboardView";
export type { PianoKey } from "./keyboardView";

/** What the keys show besides being played; see KeyboardViewSettings. */
export type KeyboardDisplayOptions = Pick<
  KeyboardViewSettings,
  "octaveLabels" | "fingerNumbers" | "noteNames" | "upcomingEffect"
>;

const DEFAULT_DISPLAY: KeyboardDisplayOptions = {
  octaveLabels: DEFAULT_KEYBOARD_VIEW_SETTINGS.octaveLabels,
  fingerNumbers: DEFAULT_KEYBOARD_VIEW_SETTINGS.fingerNumbers,
  noteNames: DEFAULT_KEYBOARD_VIEW_SETTINGS.noteNames,
  upcomingEffect: DEFAULT_KEYBOARD_VIEW_SETTINGS.upcomingEffect,
};

/** How far up its key a label sits: a share of the white keys' length, from their front edge. */
const WHITE_LABEL_LIFT = 0.13;
/** Black keys are this share of the white keys' length. */
const BLACK_KEY_LENGTH = 0.62;

interface PianoKeyboardProps {
  notes: readonly PianoKeyboardNote[];
  recognizedPitches?: readonly number[];
  attackPitches?: readonly PianoKeyboardAttack[];
  successPitches?: readonly PianoKeyboardSuccess[];
  /** The note highway lands on the keys, so the visible heading is dropped. */
  highwayAttached?: boolean;
  /** The keys shown; all 88 when absent. */
  range?: KeyboardRange;
  display?: KeyboardDisplayOptions;
  /**
   * Lay the keys on the note highway's floor, seen through its camera at this
   * tilt; only under the highway. The keyboard then covers the highway's box.
   */
  solidTilt?: number | null;
}

export interface PianoKeyboardNote {
  pitch: string;
  finger?: number;
  left?: boolean;
}

export interface PianoKeyboardAttack {
  midi: number;
  attackTimeMs: number;
}

export interface PianoKeyboardSuccess {
  midi: number;
  successTimeMs: number;
}

interface PianoKeyFingering {
  finger: number;
  left: boolean;
}

interface PianoKeyLabels {
  names: string[];
  fingerings: PianoKeyFingering[];
  /** A key both hands play at once is coloured as the right hand's. */
  left: boolean;
}

function fingeringKey({ finger, left }: PianoKeyFingering): string {
  return `${left ? "L" : "R"}${finger}`;
}

/**
 * The rendered key elements under `root`, by MIDI number, for callers that
 * restyle keys every frame without re-rendering the keyboard.
 */
export function findPianoKeyElements(root: ParentNode): Map<number, HTMLElement> {
  const keys = new Map<number, HTMLElement>();
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(".piano-keys .piano-key[data-midi]"))) {
    keys.set(Number(element.dataset.midi), element);
  }
  return keys;
}

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

/** The CSS size of an element, kept current while `active`. */
function useElementSize(active: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) {
      setSize(null);
      return;
    }
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, size };
}

export function PianoKeyboard({
  notes,
  recognizedPitches = [],
  attackPitches = [],
  successPitches = [],
  highwayAttached = false,
  range = FULL_KEYBOARD_RANGE,
  display = DEFAULT_DISPLAY,
  solidTilt = null,
}: PianoKeyboardProps) {
  const solid = highwayAttached && solidTilt !== null;
  const { ref: rootRef, size } = useElementSize(solid);
  const firstWhite = pianoKeyWhiteIndex(range.low);
  const whiteCount = pianoKeyWhiteIndex(range.high) + 1 - firstWhite;
  const keys = useMemo(
    () => PIANO_KEYS.filter((key) => key.midi >= range.low && key.midi <= range.high),
    [range.high, range.low],
  );

  // The keys as the highway camera sees them: one matrix for the key solids, and the
  // pixel size of a world unit to build them from.
  const surface = useMemo(() => {
    if (!solid || !size || !(size.width > 0) || !(size.height > 0)) return null;
    const layout = highwayLayout(
      { range, tilt: solidTilt ?? 0, keyboard3d: true },
      size.width,
      size.height,
    );
    if (!layout.keyboard) return null;
    const camera = highwayCamera(size.width / size.height, layout);
    const unit = size.width / (2 * layout.halfWidth);
    return {
      matrix: keyboardSurfaceMatrix(camera, layout, size.width, size.height),
      unit,
      depth: layout.keyboard.depth * unit,
      frontFace: layout.keyboard.frontFace * unit,
      blackHeight: layout.keyboard.blackHeight * unit,
      blackSideTaper: layout.keyboard.blackSideTaper * unit,
      blackFrontTaper: layout.keyboard.blackFrontTaper * unit,
    };
  }, [range, size, solid, solidTilt]);

  const activeLabels = useMemo(() => {
    const labels = new Map<number, PianoKeyLabels>();
    for (const note of notes) {
      const midi = pitchToMidi(note.pitch);
      if (midi === null || midi < FIRST_PIANO_MIDI || midi > LAST_PIANO_MIDI) continue;
      const label = formatKeyboardPitch(note.pitch);
      const keyLabels = labels.get(midi) ?? { names: [], fingerings: [], left: true };
      if (!keyLabels.names.includes(label)) keyLabels.names.push(label);
      if (note.left !== true) keyLabels.left = false;
      if (note.finger !== undefined) {
        const fingering = { finger: note.finger, left: note.left === true };
        const key = fingeringKey(fingering);
        if (!keyLabels.fingerings.some((existing) => fingeringKey(existing) === key)) {
          keyLabels.fingerings.push(fingering);
        }
      }
      labels.set(midi, keyLabels);
    }
    return labels;
  }, [notes]);
  const recognizedPitchSet = useMemo(
    () => new Set(
      recognizedPitches.filter(
        (midi) => midi >= FIRST_PIANO_MIDI && midi <= LAST_PIANO_MIDI,
      ),
    ),
    [recognizedPitches],
  );
  const attackByPitch = useMemo(
    () => new Map(
      attackPitches
        .filter(({ midi }) => midi >= FIRST_PIANO_MIDI && midi <= LAST_PIANO_MIDI)
        .map((attack) => [attack.midi, attack]),
    ),
    [attackPitches],
  );
  const successByPitch = useMemo(
    () => new Map(
      successPitches
        .filter(({ midi }) => midi >= FIRST_PIANO_MIDI && midi <= LAST_PIANO_MIDI)
        .map((success) => [success.midi, success]),
    ),
    [successPitches],
  );
  const activePitchNames = Array.from(activeLabels.values()).flatMap((labels) => labels.names);
  const accessibleNotes = Array.from(activeLabels.values()).flatMap((labels) =>
    labels.names.map((name) => {
      const spokenFingerings = labels.fingerings.map(({ finger, left }) =>
        `${left ? "left" : "right"} hand finger ${finger}`,
      );
      const fingering = spokenFingerings.length > 0
        ? `, ${spokenFingerings.join(" or ")}`
        : "";
      return `${name}${fingering}`;
    }),
  );

  /** Whether a played key carries a marker: its finger numbers or its note name. */
  function hasMarker(labels: PianoKeyLabels | undefined): labels is PianoKeyLabels {
    return labels !== undefined &&
      ((display.fingerNumbers && labels.fingerings.length > 0) || display.noteNames);
  }

  function keyClassName(baseClassName: string, midi: number, expected: boolean): string {
    const recognized = recognizedPitchSet.has(midi);
    return [
      "piano-key",
      baseClassName,
      expected ? "active" : "",
      recognized ? "user-active" : "",
      recognized && expected ? "user-correct" : "",
      recognized && !expected ? "user-wrong" : "",
    ].filter(Boolean).join(" ");
  }

  // Its look is the keyboard's upcoming-key effect; the note highway writes the
  // key's --approach and data-approach every frame.
  const approachOverlay = highwayAttached && display.upcomingEffect !== "off"
    ? <span className="piano-key-approach" />
    : null;

  function attackFeedback(midi: number) {
    const attack = attackByPitch.get(midi);
    return attack ? (
      <span
        key={attack.attackTimeMs}
        className="piano-key-attack"
        data-attack-time-ms={attack.attackTimeMs}
      />
    ) : null;
  }

  function successFeedback(midi: number) {
    const success = successByPitch.get(midi);
    return success ? (
      <span
        key={success.successTimeMs}
        className="piano-key-success"
        data-success-time-ms={success.successTimeMs}
      />
    ) : null;
  }

  function keyAttributes(key: PianoKey) {
    const labels = activeLabels.get(key.midi);
    const recognized = recognizedPitchSet.has(key.midi);
    const attack = attackByPitch.get(key.midi);
    const success = successByPitch.get(key.midi);
    return {
      className: keyClassName(key.black ? "piano-key-black" : "piano-key-white", key.midi, labels !== undefined),
      "data-piano-key": key.name,
      "data-midi": key.midi,
      "data-active": labels ? "true" : undefined,
      "data-hand": labels ? (labels.left ? "left" : "right") : undefined,
      "data-recognized": recognized ? "true" : undefined,
      "data-result": recognized ? (labels ? "correct" : "wrong") : undefined,
      "data-attack": attack ? attack.attackTimeMs : undefined,
      "data-success": success ? success.successTimeMs : undefined,
    };
  }

  /** Where a key's label is anchored: its bottom centre. */
  function labelPosition(key: PianoKey): CSSProperties {
    // Black keys are centred on a white-key boundary; white keys on their own
    // middle. Both are measured in white keys, the unit the layout is built on.
    const center = key.whiteIndex - firstWhite + (key.black ? 0 : 0.5);
    if (!surface) return { left: `${(center / whiteCount) * 100}%` };
    const [left, top] = key.black
      ? projectSurfacePoint(
        surface.matrix,
        center * surface.unit,
        surface.depth * BLACK_KEY_LENGTH - surface.blackFrontTaper - Math.min(8, surface.depth * 0.06),
        surface.blackHeight,
      )
      : projectSurfacePoint(surface.matrix, center * surface.unit, surface.depth * (1 - WHITE_LABEL_LIFT));
    return { left, top };
  }

  function keyLabel(key: PianoKey, labels: PianoKeyLabels) {
    return (
      <span
        className={`piano-key-label${key.black ? " piano-key-label-black" : ""}`}
        style={labelPosition(key)}
        data-midi={key.midi}
        data-pressed={recognizedPitchSet.has(key.midi) ? "true" : undefined}
      >
        {display.fingerNumbers ? labels.fingerings.map((fingering) => (
          <span
            key={fingeringKey(fingering)}
            className="piano-key-finger"
            data-hand={fingering.left ? "left" : "right"}
            data-finger={fingering.finger}
          >
            {fingering.finger}
          </span>
        )) : null}
        {display.noteNames
          ? <span className="piano-key-note-name">{labels.names.join("/")}</span>
          : null}
      </span>
    );
  }

  const keysStyle: CSSProperties | undefined = surface
    ? {
      width: `${whiteCount * surface.unit}px`,
      height: `${surface.depth}px`,
      transform: `matrix3d(${Array.from(surface.matrix, (value) => +value.toPrecision(9)).join(",")})`,
      ["--key-front-face" as string]: `${surface.frontFace}px`,
      ["--key-black-height" as string]: `${surface.blackHeight}px`,
      ["--key-black-side-taper" as string]: `${surface.blackSideTaper}px`,
      ["--key-black-front-taper" as string]: `${surface.blackFrontTaper}px`,
    }
    : undefined;
  // Labels sit in a layer above both key rows. Inside a key they were trapped in
  // that key's stacking context, so a black key -- or a later black key next
  // door -- painted over the marker. On a 3D keyboard the layer leaves the keys'
  // plane, so the markers stay upright where their key is seen.
  const labelLayer = (
    <div className="piano-key-labels">
      {keys.map((key) => {
        const labels = activeLabels.get(key.midi);
        return hasMarker(labels)
          ? <Fragment key={key.midi}>{keyLabel(key, labels)}</Fragment>
          : null;
      })}
    </div>
  );
  const lowName = pianoKeyName(range.low);
  const highName = pianoKeyName(range.high);

  return (
    <section
      ref={rootRef}
      className={[
        "piano-keyboard-overlay",
        highwayAttached ? "highway-attached" : "",
        solid ? "keyboard-3d" : "",
        approachOverlay ? `upcoming-${display.upcomingEffect}` : "",
      ].filter(Boolean).join(" ")}
      style={{
        ["--white-keys" as string]: whiteCount,
        ...(solid ? { top: `${NOTE_HIGHWAY_TOP_FRACTION * 100}%` } : {}),      }}
      aria-label={`${keys.length}-key piano keyboard. ${
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
        <span className="piano-keyboard-range">{keys.length} keys · {lowName}–{highName}</span>
      </header>
      {solid && !surface ? null : (
        <div
          className="piano-keys"
          aria-hidden="true"
          data-range={`${range.low}-${range.high}`}
          style={keysStyle}
        >
          <div className="piano-white-keys">
            {keys.filter((key) => !key.black).map((key) => (
              <div key={key.midi} {...keyAttributes(key)}>
                {surface ? <span className="piano-key-face piano-key-face-front" /> : null}
                {approachOverlay}
                {attackFeedback(key.midi)}
                {successFeedback(key.midi)}
                {display.octaveLabels && key.midi % 12 === 0 && !hasMarker(activeLabels.get(key.midi))
                  ? <span className="piano-key-octave">{key.name}</span>
                  : null}
              </div>
            ))}
          </div>
          <div className="piano-black-keys">
            {keys.filter((key) => key.black).map((key) => {
              const width = (BLACK_KEY_WIDTH_IN_WHITE_KEYS / whiteCount) * 100;
              const left = ((key.whiteIndex - firstWhite - BLACK_KEY_WIDTH_IN_WHITE_KEYS / 2) / whiteCount) * 100;
              // A solid black key is its tapered top; its walls slope out to the footprint.
              const style = surface
                ? {
                  left: `calc(${left}% + ${surface.blackSideTaper}px)`,
                  width: `calc(${width}% - ${2 * surface.blackSideTaper}px)`,
                }
                : { left: `${left}%`, width: `${width}%` };
              return (
                <div key={key.midi} {...keyAttributes(key)} style={style}>
                  {surface ? (
                    <>
                      <span className="piano-key-face piano-key-face-front" />
                      <span className="piano-key-face piano-key-face-base" />
                      <span className="piano-key-face piano-key-face-left" />
                      <span className="piano-key-face piano-key-face-right" />
                    </>
                  ) : null}
                  {approachOverlay}
                  {attackFeedback(key.midi)}
                  {successFeedback(key.midi)}
                </div>
              );
            })}
          </div>
          {surface ? null : labelLayer}
        </div>
      )}
      {surface ? labelLayer : null}
    </section>
  );
}
