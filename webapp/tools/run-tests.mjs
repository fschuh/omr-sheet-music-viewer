// Runs every test under src: each *.test.ts(x) is bundled into .test-dist with esbuild,
// React left external so tests share the installed copy, and the bundles run together
// under node --test.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webapp = fileURLToPath(new URL("..", import.meta.url));
const output = join(webapp, ".test-dist");

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const sources = testFiles(join(webapp, "src")).sort();
const bundles = sources.map((source) =>
  join(output, `${relative(join(webapp, "src"), source).replace(/\.tsx?$/, "").replaceAll("/", "__")}.mjs`),
);
await Promise.all(
  sources.map((source, index) =>
    build({
      entryPoints: [source],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
      outfile: bundles[index],
      logLevel: "warning",
    }),
  ),
);
const result = spawnSync(process.execPath, ["--test", ...bundles], { cwd: webapp, stdio: "inherit" });
process.exit(result.status ?? 1);
