import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import glsl from "vite-plugin-glsl";
import { ssamExport } from "vite-plugin-ssam-export";
import { ssamFfmpeg } from "vite-plugin-ssam-ffmpeg";
// import { ssamTimelapse } from "vite-plugin-ssam-timelapse";

/** dev only: the sketch sends its current frame ("e" key), we write it to
 *  blender/<name>.json for blender/render_variants.py */
const foldSceneExport = (): Plugin => ({
  name: "fold-scene-export",
  apply: "serve",
  configureServer(server) {
    server.ws.on(
      "fold:export",
      (data: { name: string; dir?: string; scene: unknown }, client) => {
        const clean = (s: string) => s.replace(/[^\w.-]/g, "_");
        const safe = clean(String(data.name)) || "scene";
        const dir = data.dir ? clean(String(data.dir)) : "";
        const file = path.resolve("blender", dir, `${safe}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data.scene));
        client.send("fold:exported", { file });
      },
    );
  },
});

export default defineConfig({
  base: "./",
  plugins: [
    glsl({
      warnDuplicatedImports: false,
    }),
    ssamExport(),
    ssamFfmpeg(),
    foldSceneExport(),
    // ssamTimelapse(),
  ],
  clearScreen: false,
  build: {
    outDir: "./dist",
    assetsDir: ".",
    rollupOptions: {
      //
    },
  },
});
