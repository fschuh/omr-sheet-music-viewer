// Renders MusicXML scores with the viewer's engraver, one PNG per page, for reviewing them
// by eye beside their reference PDFs (section 7 of plans/musicxml-viewer-plan.md).
//
//   npm run musicxml:render -- <output-dir> <score.mxl|.musicxml|.xml>...
//
// Each page's SVG goes into an HTML page with the Leland font and is captured with headless
// Chrome at half size: <output-dir>/<score name>/page-<n>.png.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MusicXmlPageSurface, musicXmlScoreDocument } from "../../src/musicxml";
import { readScoreFile } from "./scoreFiles";

const SCALE = 0.5;
const CHROME = process.env.CHROME ?? "google-chrome";
const FONT_URL = pathToFileURL(resolve(import.meta.dirname, "../src/musicxml/fonts/Leland.otf")).href;

function renderScore(outputDirectory: string, path: string): void {
  const name = basename(path).replace(/\.(mxl|musicxml|xml)$/i, "");
  const document = musicXmlScoreDocument("render", {
    path,
    name,
    musicXml: readScoreFile(path),
    sourceSha256: "",
    sourceByteLength: 0,
    scoreDataPath: "",
  });
  const directory = join(outputDirectory, name);
  mkdirSync(directory, { recursive: true });
  for (const page of document.pages) {
    if (!page.surface) continue;
    const markup = renderToStaticMarkup(<MusicXmlPageSurface page={page.surface} />)
      .replace(/url\("[^"]*Leland\.otf"\)/g, `url("${FONT_URL}")`);
    const width = Math.round(page.width * SCALE);
    const height = Math.round(page.height * SCALE);
    const html = join(directory, `page-${page.index + 1}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{display:block;width:${width}px;height:${height}px}</style>${markup}`,
    );
    execFileSync(CHROME, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=2000",
      `--window-size=${width},${height}`,
      `--screenshot=${join(directory, `page-${page.index + 1}.png`)}`,
      pathToFileURL(html).href,
    ], { stdio: "ignore" });
  }
  console.log(`${name}: ${document.pages.length} page(s)`);
}

const [outputDirectory, ...paths] = process.argv.slice(2);
if (!outputDirectory || paths.length === 0) {
  console.error("usage: render <output-dir> <score>...");
  process.exit(2);
}
for (const path of paths) renderScore(outputDirectory, path);
