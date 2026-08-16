export const PIANO_IDS = ["splendid", "salamander"] as const;
export type PianoId = (typeof PIANO_IDS)[number];

export const MUSICAL_DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"] as const;
export type MusicalDynamic = (typeof MUSICAL_DYNAMICS)[number];

export const SPLENDID_LAYERS = ["pp", "mp", "mf", "ff"] as const;
export const SALAMANDER_LAYERS = [
  "v01", "v02", "v03", "v04", "v05", "v06", "v07", "v08",
  "v09", "v10", "v11", "v12", "v13", "v14", "v15", "v16",
] as const;
export type SplendidPianoLayerId = (typeof SPLENDID_LAYERS)[number];
export type SalamanderPianoLayerId = (typeof SALAMANDER_LAYERS)[number];
export type PianoLayerId = SplendidPianoLayerId | SalamanderPianoLayerId;

export interface PianoSourceMetadata {
  name: string;
  version: string;
  author: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
}

export interface PianoDefinition<LayerId extends PianoLayerId = PianoLayerId> {
  id: PianoId;
  displayName: string;
  layers: readonly LayerId[];
  benchmarkLayers: readonly LayerId[];
  defaultMusicalDynamic: "mp";
  defaultLayer: LayerId;
  /** Offset from the filename's labelled MIDI pitch to concert pitch. */
  concertPitchCorrection: number;
  /** Piano-library trim applied before the shared compressor/limiter. */
  samplerVolumeDb: number;
  source: PianoSourceMetadata;
  layerForDynamic: Readonly<Record<MusicalDynamic, LayerId>>;
  sampleUrls(layer: LayerId): Readonly<Record<number, string>>;
}

const NATURAL_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function pitchLabelToMidi(pitch: string): number | null {
  const match = /^([A-Ga-g])([#s]?)(-?\d+)$/.exec(pitch.trim());
  if (!match) return null;
  const natural = NATURAL_SEMITONES[match[1].toUpperCase()];
  const accidental = match[2] === "#" || match[2] === "s" ? 1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + natural + accidental;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null;
}

const SPLENDID_SAMPLE_LABELS = [
  "B-1", "Ds0", "F0", "G0", "A0", "B0", "Cs1", "D1", "E1", "F1", "G1",
  "A1", "B1", "C2", "D2", "E2", "F2", "G2", "Gs2", "A2", "As2", "B2",
  "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4", "D4", "E4", "F4", "G4",
  "Gs4", "A4", "As4", "B4", "Cs5", "D5", "Ds5", "E5", "F5", "Fs5", "G5",
  "Gs5", "A5", "As5", "B5", "C6", "Cs6", "D6", "Ds6", "F6", "Fs6", "G6",
  "Gs6", "A6", "As6",
] as const;

const SPLENDID_LAYER_LABEL_OVERRIDES: Readonly<Partial<Record<
  SplendidPianoLayerId,
  readonly string[]
>>> = Object.freeze({
  // The public layers have a few different high-note roots. Keeping each
  // layer's actual files avoids URLs for recordings that are not distributed.
  pp: [
    "B-1", "Ds0", "F0", "G0", "A0", "B0", "Cs1", "D1", "E1", "F1", "G1",
    "A1", "B1", "C2", "D2", "E2", "F2", "G2", "Gs2", "A2", "As2", "B2",
    "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4", "D4", "E4", "F4", "G4",
    "Gs4", "A4", "As4", "B4", "Cs5", "D5", "Ds5", "F5", "Fs5", "G5", "Gs5",
    "A5", "As5", "B5", "C6", "Cs6", "D6", "Ds6", "E6", "F6", "Fs6", "G6", "Gs6",
    "A6", "As6", "B6", "C7",
  ],
  mf: [
    "B-1", "Ds0", "F0", "G0", "A0", "B0", "Cs1", "D1", "E1", "F1", "G1",
    "A1", "B1", "C2", "D2", "E2", "F2", "G2", "Gs2", "A2", "As2", "B2",
    "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4", "D4", "E4", "F4", "G4",
    "Gs4", "A4", "As4", "B4", "Cs5", "D5", "Ds5", "E5", "F5", "Fs5", "G5",
    "Gs5", "A5", "As5", "B5", "C6", "Cs6", "D6", "Ds6", "F6", "Fs6", "G6",
    "Gs6", "A6", "As6", "B6", "C7", "E6",
  ],
  ff: [
    "B-1", "Ds0", "F0", "G0", "A0", "B0", "Cs1", "D1", "E1", "F1", "G1",
    "A1", "B1", "C2", "D2", "E2", "F2", "G2", "Gs2", "A2", "As2", "B2",
    "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4", "D4", "E4", "F4", "G4",
    "Gs4", "A4", "As4", "B4", "Cs5", "D5", "E5", "F5", "G5", "A5",
  ],
});

function splendidSampleUrls(layer: SplendidPianoLayerId): Readonly<Record<number, string>> {
  const labels = SPLENDID_LAYER_LABEL_OVERRIDES[layer] ?? SPLENDID_SAMPLE_LABELS;
  return Object.freeze(Object.fromEntries(labels.map((label): [number, string] => {
    const labelledMidi = pitchLabelToMidi(label);
    if (labelledMidi === null) throw new Error(`Invalid Splendid sample label: ${label}`);
    return [
      labelledMidi + 12,
      `/audio/splendid-grand-piano/${layer}-${encodeURIComponent(label)}.ogg`,
    ];
  })));
}

const SALAMANDER_SAMPLE_LABELS = [
  "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
  "Ds1", "Ds2", "Ds3", "Ds4", "Ds5", "Ds6", "Ds7",
  "Fs1", "Fs2", "Fs3", "Fs4", "Fs5", "Fs6", "Fs7",
] as const;

function salamanderSampleUrls(layer: SalamanderPianoLayerId): Readonly<Record<number, string>> {
  const packageLayer = Number(layer.slice(1));
  return Object.freeze(Object.fromEntries(SALAMANDER_SAMPLE_LABELS.map(
    (label): [number, string] => {
      const labelledMidi = pitchLabelToMidi(label);
      if (labelledMidi === null) throw new Error(`Invalid Salamander sample label: ${label}`);
      return [
        labelledMidi,
        `/audio/salamander-grand-piano/${layer}/${label}v${packageLayer}.ogg`,
      ];
    },
  )));
}

export const PIANO_REGISTRY: Readonly<Record<PianoId, PianoDefinition>> = Object.freeze({
  splendid: Object.freeze({
    id: "splendid",
    displayName: "Splendid Grand Piano",
    layers: SPLENDID_LAYERS,
    benchmarkLayers: SPLENDID_LAYERS,
    defaultMusicalDynamic: "mp",
    defaultLayer: "mp",
    concertPitchCorrection: 12,
    samplerVolumeDb: -4,
    source: Object.freeze({
      name: "Splendid Grand Piano",
      version: "sfzinstruments public-domain release",
      author: "AKAI",
      sourceUrl: "https://github.com/sfzinstruments/SplendidGrandPiano",
      license: "Public Domain",
      licenseUrl: "https://github.com/sfzinstruments/SplendidGrandPiano",
    }),
    layerForDynamic: Object.freeze({ pp: "pp", p: "pp", mp: "mp", mf: "mf", f: "ff", ff: "ff" }),
    sampleUrls: splendidSampleUrls,
  }),
  salamander: Object.freeze({
    id: "salamander",
    displayName: "Salamander Grand Piano",
    layers: SALAMANDER_LAYERS,
    benchmarkLayers: SALAMANDER_LAYERS,
    defaultMusicalDynamic: "mp",
    // MIDI mp is conventionally near velocity 54; v07 is the nearest of the
    // 16 evenly-spaced recorded layers and is therefore the explicit default.
    defaultLayer: "v07",
    concertPitchCorrection: 0,
    samplerVolumeDb: 0,
    source: Object.freeze({
      name: "Salamander Grand Piano V3",
      version: "@audio-samples 1.0.5",
      author: "Alexander Holm",
      sourceUrl: "https://archive.org/details/SalamanderGrandPianoV3",
      license: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    }),
    layerForDynamic: Object.freeze({
      pp: "v03", p: "v05", mp: "v07", mf: "v10", f: "v13", ff: "v16",
    }),
    sampleUrls: salamanderSampleUrls,
  }),
});

export const DEFAULT_PIANO_ID: PianoId = "splendid";

export function pianoDefinition(pianoId: PianoId): PianoDefinition {
  return PIANO_REGISTRY[pianoId];
}

export function isPianoId(value: unknown): value is PianoId {
  return typeof value === "string" && (PIANO_IDS as readonly string[]).includes(value);
}

export function pianoLayerForDynamic(
  pianoId: PianoId,
  dynamic: MusicalDynamic = "mp",
): PianoLayerId {
  return pianoDefinition(pianoId).layerForDynamic[dynamic];
}

export function isPianoLayerFor(pianoId: PianoId, layer: string): layer is PianoLayerId {
  return (pianoDefinition(pianoId).layers as readonly string[]).includes(layer);
}

export function pianoSampleUrlsForLayer(
  pianoId: PianoId,
  layer: PianoLayerId,
): Record<number, string> {
  if (!isPianoLayerFor(pianoId, layer)) {
    throw new Error(`Piano layer ${layer} does not belong to ${pianoId}.`);
  }
  return { ...pianoDefinition(pianoId).sampleUrls(layer) };
}

/** Symmetric ordered layer walk with exactly one assignment per physical attack. */
export function crescendoDecrescendoLayers(
  pianoId: PianoId,
  attackCount: number,
): PianoLayerId[] {
  if (!Number.isInteger(attackCount) || attackCount <= 0) {
    throw new Error(`Attack count must be a positive integer, received ${attackCount}.`);
  }
  const layers = [...pianoDefinition(pianoId).benchmarkLayers];
  if (attackCount === 1) return [layers[0]];
  const last = layers.length - 1;
  const completeTraversalLength = layers.length * 2 - 1;
  if (attackCount >= layers.length && attackCount < completeTraversalLength) {
    const descendingCount = attackCount - layers.length;
    return [
      ...layers,
      ...Array.from({ length: descendingCount }, (_, index) => (
        layers[Math.round(last - ((index + 1) * last) / descendingCount)]
      )),
    ];
  }
  return Array.from({ length: attackCount }, (_, index) => {
    const progress = index / (attackCount - 1);
    const triangular = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
    return layers[Math.round(triangular * last)];
  });
}
