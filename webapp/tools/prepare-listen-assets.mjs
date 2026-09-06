import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The canonical online-AMT model and capture worklet belong to
// @fschuh/piano-transcription-engine. The viewer serves generated copies so the
// repository never carries a second canonical model.
const PACKAGE_NAME = "@fschuh/piano-transcription-engine";
const ASSETS = [
  "assets/models/online_amt_streaming.onnx",
  "assets/models/online_amt.LICENSE.txt",
  "assets/worklets/online-amt-capture.js",
];

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const webappDirectory = resolve(toolsDirectory, "..");
const outputDirectory = join(webappDirectory, "public", "generated-listen-assets");
const require = createRequire(import.meta.url);

let manifestPath;
try {
  manifestPath = require.resolve(`${PACKAGE_NAME}/package.json`);
} catch (error) {
  throw new Error(`Missing ${PACKAGE_NAME}. Run npm install in webapp first.`, { cause: error });
}
const packageDirectory = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function sizeOfFile(path, description) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    throw new Error(`${description} is missing: ${path}`, { cause: error });
  }
  if (!details.isFile()) throw new Error(`${description} is not a file: ${path}`);
  if (details.size === 0) throw new Error(`${description} is empty: ${path}`);
  return details.size;
}

async function isUpToDate(source, target, sourceSize) {
  let targetDetails;
  try {
    targetDetails = await stat(target);
  } catch {
    return false;
  }
  if (!targetDetails.isFile() || targetDetails.size !== sourceSize) return false;
  const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)]);
  return sourceBytes.equals(targetBytes);
}

await mkdir(outputDirectory, { recursive: true });
let copied = 0;
for (const asset of ASSETS) {
  const source = join(packageDirectory, asset);
  const target = join(outputDirectory, asset.split("/").at(-1));
  const sourceSize = await sizeOfFile(source, `${PACKAGE_NAME} asset`);
  if (await isUpToDate(source, target, sourceSize)) continue;
  await copyFile(source, target);
  await sizeOfFile(target, "Prepared listen asset");
  copied += 1;
}

const version = `${manifest.name}@${manifest.version}`;
console.log(
  copied === 0
    ? `Listen assets are current (${ASSETS.length} files from ${version}).`
    : `Prepared ${copied} of ${ASSETS.length} listen assets from ${version}.`,
);
