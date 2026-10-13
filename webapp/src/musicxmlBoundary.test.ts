import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { imports, SIDECAR_NAMES } from "./importScan";

// The MusicXML viewer is a module with one entry point, and inside it each stage owns one
// kind of dependency. These rules are the module's boundaries; see section 3.1 of
// plans/musicxml-viewer-plan.md.

/** Files outside the module this module may use, and which stages may use them. */
const SHARED_FILES: Record<string, "all" | string[]> = {
  noteGeometry: "all",
  types: "all",
  fingering: "all",
  native: ["scoreData"],
};

/** Packages the module may use, and the one stage that may use each. */
const PACKAGES: Record<string, string> = {
  react: "render",
  "react/jsx-runtime": "render",
  "react-dom/server": "render",
  "@xmldom/xmldom": "import",
};

/** Violations of the module's boundaries in `file`, a path relative to `src/`. */
function boundaryViolations(file: string, source: string): string[] {
  const inModule = file.startsWith("musicxml/");
  // "index.ts" for the entry point, else the stage folder.
  const stage = inModule ? file.split("/")[1] : null;
  const isTest = /\.test\.tsx?$/.test(file);
  return imports(source).flatMap(({ specifier, names }): string[] => {
    if (!specifier.startsWith(".")) {
      if (!inModule || (isTest && specifier.startsWith("node:"))) return [];
      return PACKAGES[specifier] === stage ? [] : [`${file}: ${specifier}`];
    }
    const target = posix
      .normalize(posix.join(posix.dirname(file), specifier))
      .replace(/\.tsx?$/, "");
    const targetInModule = target === "musicxml" || target.startsWith("musicxml/");
    if (!inModule) {
      return targetInModule && target !== "musicxml" && target !== "musicxml/index"
        ? [`${file}: ${specifier}`]
        : [];
    }
    if (targetInModule) return [];
    const allowed = SHARED_FILES[target];
    if (!allowed || (allowed !== "all" && !allowed.includes(stage!))) return [`${file}: ${specifier}`];
    if (target === "types") {
      return names.filter((name) => SIDECAR_NAMES.includes(name)).map((name) => `${file}: ${name}`);
    }
    return [];
  });
}

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(posix.join(directory, entry.name), `${path}/`);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("the MusicXML module and its users keep to the module's boundaries", () => {
  // Tests are bundled into .test-dist, next to src.
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  // This file's sample imports are strings that break the rules on purpose.
  const files = sourceFiles(sourceRoot).filter((file) => file !== "musicxmlBoundary.test.ts");
  assert.ok(files.includes("musicxml/index.ts") && files.includes("App.tsx"));
  const violations = files.flatMap((file) =>
    boundaryViolations(file, readFileSync(posix.join(sourceRoot, file), "utf8")),
  );
  assert.deepEqual(violations, []);
});

test("code outside the module reaches it only through index.ts", () => {
  assert.deepEqual(boundaryViolations("App.tsx", 'import { openMusicXmlScore } from "./musicxml";'), []);
  assert.deepEqual(boundaryViolations("App.tsx", 'import { x } from "./musicxml/index";'), []);
  assert.deepEqual(
    boundaryViolations("App.tsx", 'import { layoutPages } from "./musicxml/layout/pages";'),
    ["App.tsx: ./musicxml/layout/pages"],
  );
  assert.deepEqual(
    boundaryViolations("noteHighway/a.ts", 'export * from "../musicxml/model/score";'),
    ["noteHighway/a.ts: ../musicxml/model/score"],
  );
});

test("the module uses only the shared files it is allowed", () => {
  assert.deepEqual(
    boundaryViolations("musicxml/layout/pages.ts", 'import type { DocumentPage } from "../../types";'),
    [],
  );
  assert.deepEqual(
    boundaryViolations("musicxml/index.ts", 'import { DocumentViewer } from "../DocumentViewer";'),
    ["musicxml/index.ts: ../DocumentViewer"],
  );
  assert.deepEqual(
    boundaryViolations("musicxml/geometry/a.ts", 'import { pdfNoteGeometry } from "../../sidecarNoteGeometry";'),
    ["musicxml/geometry/a.ts: ../../sidecarNoteGeometry"],
  );
  assert.deepEqual(
    boundaryViolations("musicxml/index.ts", 'import type { LoadedDocument, VisualSidecar } from "../types";'),
    ["musicxml/index.ts: VisualSidecar"],
  );
});

test("inside the module, only scoreData uses the native bridge", () => {
  const native = 'import { readMusicXmlScoreFile } from "../../native";';
  assert.deepEqual(boundaryViolations("musicxml/scoreData/scoreData.ts", native), []);
  assert.deepEqual(boundaryViolations("musicxml/layout/pages.ts", native), [
    "musicxml/layout/pages.ts: ../../native",
  ]);
  assert.deepEqual(boundaryViolations("musicxml/index.ts", 'import "../native";'), [
    "musicxml/index.ts: ../native",
  ]);
});

test("only render uses React and only import reads XML", () => {
  assert.deepEqual(boundaryViolations("musicxml/render/Surface.tsx", 'import { memo } from "react";'), []);
  assert.deepEqual(boundaryViolations("musicxml/layout/pages.ts", 'import { memo } from "react";'), [
    "musicxml/layout/pages.ts: react",
  ]);
  assert.deepEqual(
    boundaryViolations("musicxml/import/parse.ts", 'import { DOMParser } from "@xmldom/xmldom";'),
    [],
  );
  assert.deepEqual(
    boundaryViolations("musicxml/layout/pages.ts", 'const xml = await import("@xmldom/xmldom");'),
    ["musicxml/layout/pages.ts: @xmldom/xmldom"],
  );
  assert.deepEqual(
    boundaryViolations("musicxml/index.ts", 'import { invoke } from "@tauri-apps/api/core";'),
    ["musicxml/index.ts: @tauri-apps/api/core"],
  );
  assert.deepEqual(boundaryViolations("musicxml/layout/a.test.ts", 'import test from "node:test";'), []);
  assert.deepEqual(boundaryViolations("musicxml/layout/a.ts", 'import { readFileSync } from "node:fs";'), [
    "musicxml/layout/a.ts: node:fs",
  ]);
});
