// Reads MusicXML score files in node, as the app's native side does: `.musicxml` and
// `.xml` as text, `.mxl` through its META-INF/container.xml.
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}

export function readScoreFile(path: string): string {
  const bytes = readFileSync(path);
  if (!/\.mxl$/i.test(path)) return decode(bytes);
  const entries = unzipSync(bytes);
  const container = entries["META-INF/container.xml"];
  if (!container) throw new Error(`${path} has no META-INF/container.xml`);
  const root = /<rootfile[^>]*full-path="([^"]+)"/.exec(strFromU8(container))?.[1]
    ?.replaceAll("&amp;", "&");
  if (!root || !entries[root]) throw new Error(`${path} does not contain the score its container names`);
  return decode(entries[root]);
}
