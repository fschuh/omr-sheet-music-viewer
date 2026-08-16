import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = "1.0.5";
const LAYER_COUNT = 16;
const FILES_PER_LAYER = 30;
const EXPECTED_ROOTS = [
  "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
  "D#1", "D#2", "D#3", "D#4", "D#5", "D#6", "D#7",
  "F#1", "F#2", "F#3", "F#4", "F#5", "F#6", "F#7",
];
const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const webappDirectory = resolve(toolsDirectory, "..");
const packagesDirectory = join(webappDirectory, "node_modules", "@audio-samples");
const outputDirectory = join(webappDirectory, "public", "audio", "salamander-grand-piano");
const markerPath = join(outputDirectory, ".prepared.json");

function layerId(index) {
  return `v${String(index).padStart(2, "0")}`;
}

async function packageDescription(index) {
  const name = `@audio-samples/piano-velocity${index}`;
  const root = join(packagesDirectory, `piano-velocity${index}`);
  const manifestPath = join(root, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Missing ${name}. Run npm install in webapp first.`, { cause: error });
  }
  if (manifest.name !== name || manifest.version !== PACKAGE_VERSION) {
    throw new Error(
      `Expected ${name}@${PACKAGE_VERSION}, received ${manifest.name}@${manifest.version}.`,
    );
  }
  const audioRoot = join(root, "audio");
  const entries = (await readdir(audioRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ogg"))
    .map((entry) => entry.name)
    .sort();
  if (entries.length !== FILES_PER_LAYER) {
    throw new Error(`${name} should contain ${FILES_PER_LAYER} OGG roots, found ${entries.length}.`);
  }
  const expectedFiles = EXPECTED_ROOTS.map((rootName) => `${rootName}v${index}.ogg`).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${name} does not contain the expected Salamander sample roots.`);
  }
  for (const filename of entries) {
    const details = await stat(join(audioRoot, filename));
    if (details.size <= 0) throw new Error(`${name}/audio/${filename} is empty.`);
  }
  return { name, version: manifest.version, root, audioRoot, files: entries };
}

function markerFor(packages) {
  return {
    schemaVersion: 1,
    generatedFrom: packages.map(({ name, version, files }) => ({
      name,
      version,
      fileCount: files.length,
    })),
    filenameRule: "replace # with s",
  };
}

async function preparedAssetsAreValid(packages, expectedMarker) {
  let currentMarker;
  try {
    currentMarker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return false;
  }
  if (JSON.stringify(currentMarker) !== JSON.stringify(expectedMarker)) return false;
  for (let index = 1; index <= LAYER_COUNT; index += 1) {
    const outputLayer = join(outputDirectory, layerId(index));
    let files;
    try {
      files = (await readdir(outputLayer, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ogg"));
    } catch {
      return false;
    }
    if (files.length !== FILES_PER_LAYER) return false;
    const expectedNames = new Set(packages[index - 1].files.map((name) => name.replaceAll("#", "s")));
    for (const file of files) {
      if (!expectedNames.has(file.name) || (await stat(join(outputLayer, file.name))).size <= 0) {
        return false;
      }
    }
  }
  return true;
}

const packages = await Promise.all(
  Array.from({ length: LAYER_COUNT }, (_, index) => packageDescription(index + 1)),
);
const marker = markerFor(packages);
if (await preparedAssetsAreValid(packages, marker)) {
  console.log(`Salamander piano assets are current (${LAYER_COUNT * FILES_PER_LAYER} files).`);
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
for (let index = 1; index <= LAYER_COUNT; index += 1) {
  const source = packages[index - 1];
  const outputLayer = join(outputDirectory, layerId(index));
  await rm(outputLayer, { recursive: true, force: true });
  await mkdir(outputLayer, { recursive: true });
  for (const filename of source.files) {
    await cp(join(source.audioRoot, filename), join(outputLayer, filename.replaceAll("#", "s")));
  }
}
await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

if (!await preparedAssetsAreValid(packages, marker)) {
  throw new Error("Prepared Salamander assets failed post-copy validation.");
}
console.log(`Prepared ${LAYER_COUNT * FILES_PER_LAYER} Salamander piano samples.`);
