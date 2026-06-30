import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.resolve(dirname, "../images");

function sampleAssetsPlugin(): Plugin {
  return {
    name: "homr-sample-assets",
    configureServer(server) {
      server.middlewares.use("/sample", (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const requestedName = decodeURIComponent(req.url.replace(/^\/+/, ""));
        const filePath = path.resolve(sampleDir, requestedName);
        if (!filePath.startsWith(sampleDir) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === ".png"
            ? "image/png"
            : ext === ".json"
              ? "application/json"
              : ext === ".musicxml" || ext === ".xml"
                ? "application/xml"
                : "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sampleAssetsPlugin()],
});
