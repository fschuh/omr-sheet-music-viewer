import type { PredictedFingering } from "./fingering";

export const SOURCE_FIELD = "homr-source-fingerings-v1";
const GENERATED_FIELD = "homr-piano-fingering-cache";

export interface SourceFingering {
  text: string;
  attributes: Record<string, string>;
}

export interface SourceNoteFingerings {
  musicXmlId: string | null;
  noteIndex: number;
  provenance: "source" | "unknown-generated-cache";
  markings: SourceFingering[];
}

export interface SourceFingerings {
  version: 1;
  notes: SourceNoteFingerings[];
}

export interface EffectiveFingering extends PredictedFingering {
  source: "prediction" | "adopted-source" | "user";
}

export interface NoteValueOverride {
  finger: number;
  /** The recognition revision, not the prediction model revision. */
  annotationRevision: string;
}

export function supportedFinger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Visibility and position are intentionally absent from the value resolver. */
export function resolveFingering(
  prediction: PredictedFingering | undefined,
  override: NoteValueOverride | undefined,
  annotationRevision: string,
  adoptedSource?: { finger: number; left: boolean; confirmed: boolean; annotationRevision: string },
): EffectiveFingering | undefined {
  const source = adoptedSource?.confirmed && adoptedSource.annotationRevision === annotationRevision
    && supportedFinger(adoptedSource.finger) ? adoptedSource : undefined;
  const underlying = source ?? (prediction && supportedFinger(prediction.finger) ? prediction : undefined);
  // A digit alone cannot establish hand assignment.
  if (override?.annotationRevision === annotationRevision && supportedFinger(override.finger) && underlying) {
    return { finger: override.finger, left: underlying.left, source: "user" };
  }
  if (source) return { finger: source.finger, left: source.left, source: "adopted-source" };
  return underlying ? { ...underlying, source: "prediction" } : undefined;
}

function descendants(root: Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === name);
}

function field(root: Element, name: string): Element | undefined {
  return descendants(root, "miscellaneous-field").find((node) => node.getAttribute("name") === name);
}

/** Capture before modifying any technical elements. Unknown caches are never editorial sources. */
export function captureSourceFingerings(document: XMLDocument): SourceFingerings {
  const root = document.documentElement;
  const preserved = field(root, SOURCE_FIELD);
  if (preserved) {
    // Fail closed: overwriting a damaged snapshot would destroy the only original.
    const parsed = JSON.parse(preserved.textContent ?? "") as SourceFingerings;
    if (parsed.version !== 1 || !Array.isArray(parsed.notes) || parsed.notes.some((note) =>
      !note || !(note.musicXmlId === null || typeof note.musicXmlId === "string") ||
      !Number.isInteger(note.noteIndex) || note.noteIndex < 0 ||
      !["source", "unknown-generated-cache"].includes(note.provenance) ||
      !Array.isArray(note.markings) || note.markings.some((mark) =>
        !mark || typeof mark.text !== "string" || !mark.attributes ||
        typeof mark.attributes !== "object" || Array.isArray(mark.attributes) ||
        Object.values(mark.attributes).some((value) => typeof value !== "string")))) {
      throw new Error("Invalid preserved source fingering data");
    }
    return parsed;
  }
  const generated = !!field(root, GENERATED_FIELD);
  return {
    version: 1,
    notes: descendants(root, "note").flatMap((note, noteIndex) => {
      const markings = descendants(note, "fingering").map((mark) => ({
        text: mark.textContent ?? "",
        attributes: Object.fromEntries(Array.from(mark.attributes).map((attr) => [attr.name, attr.value])),
      }));
      return [{
        musicXmlId: note.getAttribute("id") || null, noteIndex,
        provenance: generated ? "unknown-generated-cache" as const : "source" as const,
        markings,
      }];
    }),
  };
}

export function preserveSourceFingerings(document: XMLDocument, source: SourceFingerings): void {
  const root = document.documentElement;
  const existing = field(root, SOURCE_FIELD);
  if (existing) {
    existing.textContent = JSON.stringify(source);
    return;
  }
  const create = (name: string) => document.createElementNS(root.namespaceURI, `${root.prefix ? `${root.prefix}:` : ""}${name}`);
  let identification = Array.from(root.childNodes).find((node) => node.nodeType === 1 && (node as Element).localName === "identification") as Element | undefined;
  if (!identification) {
    identification = create("identification");
    const later = Array.from(root.childNodes).find((node) => node.nodeType === 1 && ["defaults", "credit", "part-list", "part"].includes((node as Element).localName));
    root.insertBefore(identification, later ?? null);
  }
  let miscellaneous = descendants(identification, "miscellaneous")[0];
  if (!miscellaneous) {
    miscellaneous = create("miscellaneous");
    identification.appendChild(miscellaneous);
  }
  const snapshot = create("miscellaneous-field");
  snapshot.setAttribute("name", SOURCE_FIELD);
  snapshot.textContent = JSON.stringify(source);
  miscellaneous.appendChild(snapshot);
}

/** Recover only from exact page-scoped IDs in original page artifacts. */
export function recoverSourceFingerings(
  snapshot: SourceFingerings,
  originals: ReadonlyMap<string, SourceNoteFingerings>,
): SourceFingerings {
  return { version: 1, notes: snapshot.notes.map((note) => {
    const original = note.musicXmlId ? originals.get(note.musicXmlId) : undefined;
    return note.provenance === "unknown-generated-cache" && original?.provenance === "source"
      ? { ...original, musicXmlId: note.musicXmlId, noteIndex: note.noteIndex } : note;
  }) };
}

/** Page order must be the ordered, successfully merged pages (including no blank pages). */
export function migrateSourceFingerings(musicXml: string, originalPages: readonly (string | undefined)[]): string {
  const document = new DOMParser().parseFromString(musicXml, "application/xml");
  const snapshot = captureSourceFingerings(document);
  if (!snapshot.notes.some((note) => note.provenance === "unknown-generated-cache")) return musicXml;
  const originals = new Map<string, SourceNoteFingerings>();
  originalPages.forEach((xml, index) => {
    if (!xml) return;
    const original = captureSourceFingerings(new DOMParser().parseFromString(xml, "application/xml"));
    for (const note of original.notes) {
      if (note.musicXmlId && note.provenance === "source") originals.set(`page-${index + 1}-${note.musicXmlId}`, note);
    }
  });
  preserveSourceFingerings(document, recoverSourceFingerings(snapshot, originals));
  return new XMLSerializer().serializeToString(document);
}
