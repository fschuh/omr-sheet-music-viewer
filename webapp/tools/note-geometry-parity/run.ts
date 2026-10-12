// Records what the viewer does with each recognized PDF page: playback timelines,
// realtime note targets, selections, pitch labels, hit testing, and playback scroll
// extents. Recording the same pdf-cache inputs before and after a change to the
// note-geometry consumers, then comparing the two recordings, shows whether PDF
// behavior changed.
//
//   npm run parity:note-geometry -- record <output-dir> <pdf-cache-dir>...
//   npm run parity:note-geometry -- compare <baseline-dir> <candidate-dir>
//
// A pdf-cache dir is either one document (it holds manifest.json) or a folder of them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PredictedFingering } from "../../src/fingering";
import { parseRealtimeMusicXml, type RealtimeScore } from "../../src/realtime";
import type { DocumentPage, VisualPoint, VisualSidecar } from "../../src/types";
import { harness } from "./harness";

const GRID_STEP = 48;
const HIT_PADDING = 3;
const MAX_REPORTED_DIFFERENCES = 40;

interface ManifestPage {
  index: number;
  status: string;
  width?: number;
  height?: number;
  image?: string;
  musicXml?: string;
  visualSidecar?: string;
}

interface Manifest {
  pageCount: number;
  documentMusicXml?: string;
  pages: ManifestPage[];
}

function documentDirectories(path: string): string[] {
  if (existsSync(join(path, "manifest.json"))) return [path];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => documentDirectories(join(path, entry.name)));
}

function loadPages(directory: string, manifest: Manifest): DocumentPage[] {
  return manifest.pages.map((entry): DocumentPage => {
    const width = entry.width ?? 0;
    const height = entry.height ?? 0;
    if (entry.status === "complete" && entry.musicXml && entry.visualSidecar && entry.image) {
      const musicXmlPath = join(directory, entry.musicXml);
      const visualSidecarPath = join(directory, entry.visualSidecar);
      const musicXml = readFileSync(musicXmlPath, "utf8");
      const visualSidecarText = readFileSync(visualSidecarPath, "utf8");
      return {
        index: entry.index,
        status: "complete",
        width,
        height,
        artifacts: {
          imagePath: join(directory, entry.image),
          musicXmlPath,
          visualSidecarPath,
          width,
          height,
          musicXmlBytes: musicXml.length,
          visualSidecarBytes: visualSidecarText.length,
        },
        musicXml,
        visualSidecar: JSON.parse(visualSidecarText) as VisualSidecar,
      };
    }
    return {
      index: entry.index,
      status: entry.status === "skipped" ? "skipped" : "failed",
      width,
      height,
    };
  });
}

/** FNV-1a, so the synthetic fingerings are the same in every recording. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Every score note gets a finger, so timelines show whether fingering lookups still match. */
function syntheticFingerings(score: RealtimeScore | null): Record<string, PredictedFingering> {
  const result: Record<string, PredictedFingering> = {};
  for (const measure of score?.measures ?? []) {
    for (const note of measure.notes) {
      const value = hash(note.musicXmlId);
      result[note.musicXmlId] = { finger: (value % 5) + 1, left: (value >> 3) % 2 === 0 };
    }
  }
  return result;
}

function contourBounds(points: VisualPoint[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Points just inside and just outside every hit boundary, plus every center. */
function probePoints(sidecar: VisualSidecar): VisualPoint[] {
  const points: VisualPoint[] = [];
  const around = ([left, top, right, bottom]: number[], offsets: number[]) => {
    for (const offset of offsets) {
      points.push(
        [left - offset, top - offset],
        [right + offset, bottom + offset],
        [left - offset, (top + bottom) / 2],
        [right + offset, (top + bottom) / 2],
        [(left + right) / 2, top - offset],
        [(left + right) / 2, bottom + offset],
      );
    }
  };
  for (const group of sidecar.visual_groups) {
    points.push(group.center);
    for (const contour of group.notehead_contours) {
      const bounds = contourBounds(contour);
      if (bounds) around(bounds, [HIT_PADDING - 0.5, HIT_PADDING + 0.5]);
    }
    if (group.bbox.length === 4) around(group.bbox, [-0.5, 0.5]);
  }
  return points;
}

function runLengths(values: (string | null)[]): string[] {
  const result: string[] = [];
  let index = 0;
  while (index < values.length) {
    let end = index + 1;
    while (end < values.length && values[end] === values[index]) end += 1;
    result.push(`${values[index] ?? "-"}*${end - index}`);
    index = end;
  }
  return result;
}

function recordPage(pages: DocumentPage[], page: DocumentPage, moments: ReturnType<typeof harness.timeline>) {
  const sidecar = page.visualSidecar!;
  const linked = sidecar.visual_groups
    .filter((group) => group.visual_status !== "diagnostic" && group.musicxml_id !== null)
    .map((group) => group.visual_group_id);
  const allIds = sidecar.visual_groups.map((group) => group.visual_group_id);
  const selections: Record<string, string[]> = {};
  for (const diagnostics of [false, true]) {
    selections[`none:${diagnostics}`] = harness.selection(pages, page, null, false, diagnostics);
    selections[`all:${diagnostics}`] = harness.selection(pages, page, null, true, diagnostics);
    selections[`other-page:${diagnostics}`] = harness.selection(
      pages, page, { pageIndex: page.index + 1000, visualGroupId: linked[0] ?? "" }, false, diagnostics,
    );
    for (const id of allIds) {
      selections[`${id}:${diagnostics}`] = harness.selection(
        pages, page, { pageIndex: page.index, visualGroupId: id }, false, diagnostics,
      ).sort();
    }
  }

  const labels: Record<string, unknown> = {
    all: harness.labels(pages, page, new Set(selections["all:false"])),
  };
  for (const id of linked) {
    labels[id] = harness.labels(pages, page, new Set(selections[`${id}:false`]));
  }
  const pageMoments = moments.filter((moment) => moment.pageIndex === page.index);
  for (const moment of pageMoments) {
    labels[`moment:${moment.id}`] = harness.labels(pages, page, new Set(moment.visualGroupIds));
  }

  const hits: Record<string, unknown> = {};
  const probes = probePoints(sidecar);
  for (const diagnostics of [false, true]) {
    const grid: string[][] = [];
    for (let y = 0; y <= page.height; y += GRID_STEP) {
      const row: (string | null)[] = [];
      for (let x = 0; x <= page.width; x += GRID_STEP) {
        row.push(harness.hit(pages, page, [x, y], diagnostics));
      }
      grid.push(runLengths(row));
    }
    hits[`grid:${diagnostics}`] = grid;
    hits[`probes:${diagnostics}`] = runLengths(
      probes.map((point) => harness.hit(pages, page, point, diagnostics)),
    );
  }

  return {
    index: page.index,
    selections,
    labels,
    hits,
    extents: Object.fromEntries(
      pageMoments.map((moment) => [moment.id, harness.extents(pages, page, moment)]),
    ),
  };
}

function record(outputDirectory: string, inputs: string[]): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const directory of inputs.flatMap(documentDirectories).sort()) {
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as Manifest;
    const pages = loadPages(directory, manifest);
    const recognized = pages.filter((page) => page.visualSidecar);
    if (recognized.length === 0 || recognized.some((page) => page.visualSidecar!.version !== 3)) {
      console.warn(`skipped ${directory}: no version 3 visual sidecars`);
      continue;
    }
    let documentScore: RealtimeScore | null = null;
    if (manifest.documentMusicXml) {
      try {
        documentScore = parseRealtimeMusicXml(
          readFileSync(join(directory, manifest.documentMusicXml), "utf8"),
        );
      } catch (error) {
        console.warn(`${directory}: document MusicXML did not parse: ${String(error)}`);
      }
    }
    const fingerings = syntheticFingerings(documentScore);
    const documentTimeline = harness.timeline(pages, fingerings, documentScore);
    const result = {
      document: basename(directory),
      documentScore: documentScore !== null,
      timelines: {
        document: documentTimeline,
        pageScores: harness.timeline(pages, fingerings, null),
      },
      visualTargets: [...harness.visualTargets(pages)].sort(([first], [second]) =>
        first.localeCompare(second),
      ),
      pages: recognized.map((page) => recordPage(pages, page, documentTimeline)),
    };
    writeFileSync(join(outputDirectory, `${basename(directory)}.json`), JSON.stringify(result, null, 1));
    console.log(
      `recorded ${basename(directory).slice(0, 12)}: ${recognized.length} page(s), ` +
        `${documentTimeline.length} moment(s), document score ${documentScore ? "yes" : "no"}`,
    );
  }
}

function differences(baseline: unknown, candidate: unknown, path: string, found: string[]): void {
  if (found.length >= MAX_REPORTED_DIFFERENCES) return;
  if (Object.is(baseline, candidate)) return;
  if (
    typeof baseline !== "object" || typeof candidate !== "object" ||
    baseline === null || candidate === null ||
    Array.isArray(baseline) !== Array.isArray(candidate)
  ) {
    found.push(`${path}: ${JSON.stringify(baseline)} -> ${JSON.stringify(candidate)}`);
    return;
  }
  const keys = new Set([...Object.keys(baseline), ...Object.keys(candidate)]);
  for (const key of keys) {
    differences(
      (baseline as Record<string, unknown>)[key],
      (candidate as Record<string, unknown>)[key],
      `${path}/${key}`,
      found,
    );
  }
}

function compare(baselineDirectory: string, candidateDirectory: string): void {
  const names = new Set([...readdirSync(baselineDirectory), ...readdirSync(candidateDirectory)]);
  let changed = 0;
  for (const name of [...names].sort()) {
    const baselinePath = join(baselineDirectory, name);
    const candidatePath = join(candidateDirectory, name);
    if (!existsSync(baselinePath) || !existsSync(candidatePath)) {
      console.log(`${name}: only in ${existsSync(baselinePath) ? "baseline" : "candidate"}`);
      changed += 1;
      continue;
    }
    const baselineText = readFileSync(baselinePath, "utf8");
    const candidateText = readFileSync(candidatePath, "utf8");
    if (baselineText === candidateText) continue;
    changed += 1;
    const found: string[] = [];
    differences(JSON.parse(baselineText), JSON.parse(candidateText), "", found);
    console.log(`${name}: differs`);
    for (const line of found) console.log(`  ${line.slice(0, 400)}`);
  }
  console.log(changed === 0 ? `identical (${names.size} document(s))` : `${changed} document(s) differ`);
  process.exitCode = changed === 0 ? 0 : 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === "record" && args.length >= 2) record(args[0], args.slice(1));
else if (command === "compare" && args.length === 2) compare(args[0], args[1]);
else {
  console.error("usage: record <output-dir> <pdf-cache-dir>... | compare <baseline-dir> <candidate-dir>");
  process.exitCode = 2;
}
