// Builds small MusicXML scores for the module's tests.

export interface NoteOptions {
  type?: string;
  voice?: string | number;
  staff?: number;
  /** Joins the previous note's chord. */
  chord?: boolean;
  dots?: number;
  stem?: "up" | "down" | "none";
  /** Beam values by level, starting with the eighth-note beam. */
  beams?: string[];
  accidental?: string;
  grace?: boolean | "slash";
  tie?: "start" | "stop";
  /** Where a rest sits, as a pitch such as "E4". */
  restAt?: string;
  measureRest?: boolean;
  /** Raw MusicXML appended inside the note, such as `<notations>…</notations>`. */
  extra?: string;
}

function pitchParts(pitch: string): { step: string; alter: number; octave: number } {
  const match = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(pitch);
  if (!match) throw new Error(`Not a pitch: ${pitch}`);
  const accidental = match[2] ?? "";
  return {
    step: match[1],
    alter: accidental.startsWith("#") ? accidental.length : -accidental.length,
    octave: Number(match[3]),
  };
}

/** A note, or a rest when `pitch` is null; `duration` is in divisions. */
export function note(pitch: string | null, duration: number, options: NoteOptions = {}): string {
  const parts: string[] = [];
  if (options.grace) parts.push(options.grace === "slash" ? '<grace slash="yes"/>' : "<grace/>");
  if (options.chord) parts.push("<chord/>");
  if (pitch === null) {
    if (options.restAt) {
      const { step, octave } = pitchParts(options.restAt);
      parts.push(`<rest><display-step>${step}</display-step><display-octave>${octave}</display-octave></rest>`);
    } else {
      parts.push(options.measureRest ? '<rest measure="yes"/>' : "<rest/>");
    }
  } else {
    const { step, alter, octave } = pitchParts(pitch);
    parts.push(`<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`);
  }
  if (!options.grace) parts.push(`<duration>${duration}</duration>`);
  if (options.tie) parts.push(`<tie type="${options.tie}"/>`);
  parts.push(`<voice>${options.voice ?? 1}</voice>`);
  if (options.type) parts.push(`<type>${options.type}</type>`);
  for (let dot = 0; dot < (options.dots ?? 0); dot += 1) parts.push("<dot/>");
  if (options.accidental) parts.push(`<accidental>${options.accidental}</accidental>`);
  if (options.stem) parts.push(`<stem>${options.stem}</stem>`);
  parts.push(`<staff>${options.staff ?? 1}</staff>`);
  (options.beams ?? []).forEach((value, index) => parts.push(`<beam number="${index + 1}">${value}</beam>`));
  if (options.extra) parts.push(options.extra);
  return `<note>${parts.join("")}</note>`;
}

export function backup(duration: number): string {
  return `<backup><duration>${duration}</duration></backup>`;
}

export interface AttributeOptions {
  divisions?: number;
  fifths?: number;
  time?: [number, number];
  staves?: number;
  /** Clef signs by staff, such as ["G", "F"]. */
  clefs?: string[];
}

export function attributes(options: AttributeOptions): string {
  const parts: string[] = [];
  if (options.divisions) parts.push(`<divisions>${options.divisions}</divisions>`);
  if (options.fifths !== undefined) parts.push(`<key><fifths>${options.fifths}</fifths></key>`);
  if (options.time) parts.push(`<time><beats>${options.time[0]}</beats><beat-type>${options.time[1]}</beat-type></time>`);
  if (options.staves) parts.push(`<staves>${options.staves}</staves>`);
  (options.clefs ?? []).forEach((sign, index) => {
    const line = sign === "F" ? 4 : sign === "C" ? 3 : 2;
    parts.push(`<clef number="${index + 1}"><sign>${sign}</sign><line>${line}</line></clef>`);
  });
  return `<attributes>${parts.join("")}</attributes>`;
}

/** A barline, such as `barline("right", "<repeat direction=\"backward\"/>")`. */
export function barline(location: "left" | "right", content: string): string {
  return `<barline location="${location}">${content}</barline>`;
}

export function measure(content: string, print = ""): string {
  return `<measure>${print}${content}</measure>`;
}

export function part(id: string, measures: string[]): string {
  return `<part id="${id}">${measures.join("")}</part>`;
}

export function score(parts: string[], defaults = ""): string {
  const ids = parts.map((value) => /<part id="([^"]+)"/.exec(value)?.[1] ?? "P1");
  const list = ids.map((id) => `<score-part id="${id}"><part-name>${id}</part-name></score-part>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${defaults}<part-list>${list}</part-list>${parts.join("")}</score-partwise>`;
}

/** A piano part: treble and bass staves in one part. */
export function piano(measures: string[], first: AttributeOptions = {}): string {
  const [head, ...rest] = measures;
  return part("P1", [
    measure(attributes({ divisions: 4, fifths: 0, time: [4, 4], staves: 2, clefs: ["G", "F"], ...first }) + head),
    ...rest.map((content) => measure(content)),
  ]);
}
