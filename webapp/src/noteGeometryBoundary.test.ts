import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { imports, SIDECAR_NAMES } from "./importScan";

// The code every score source shares reads note geometry only. homr's visual sidecar
// reaches it solely through the PDF adapter, so a MusicXML page can feed it unchanged.
const SHARED_CONSUMERS = ["noteGeometry.ts", "playback.ts", "realtime.ts", "noteLabels.ts"];

function sidecarDependencies(source: string): string[] {
  return imports(source).flatMap(({ specifier, names }) => {
    if (/(^|\/)sidecarNoteGeometry$/.test(specifier)) return [specifier];
    if (!/(^|\/)types$/.test(specifier)) return [];
    return names.filter((name) => SIDECAR_NAMES.includes(name));
  });
}

test("shared note-geometry consumers do not depend on the visual sidecar", () => {
  // Tests are bundled into .test-dist, next to src.
  for (const file of SHARED_CONSUMERS) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.deepEqual(sidecarDependencies(source), [], `${file} depends on the visual sidecar`);
  }
});

test("the boundary check sees sidecar imports however they are written", () => {
  assert.deepEqual(
    sidecarDependencies('import type { DocumentPage, VisualGroup } from "./types";'),
    ["VisualGroup"],
  );
  assert.deepEqual(
    sidecarDependencies('import {\n  isLinkedVisualGroup,\n  type VisualSidecar as Sidecar,\n} from "./types";'),
    ["isLinkedVisualGroup", "VisualSidecar"],
  );
  assert.deepEqual(
    sidecarDependencies('import { pdfNoteGeometry } from "./sidecarNoteGeometry";'),
    ["./sidecarNoteGeometry"],
  );
  assert.deepEqual(
    sidecarDependencies('import type { DocumentPage, VisualGroupRef } from "./types";'),
    [],
  );
});
