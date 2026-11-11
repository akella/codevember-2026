import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import { ssamExport } from "vite-plugin-ssam-export";
import { ssamFfmpeg } from "vite-plugin-ssam-ffmpeg";

// run through portless (https://<day>.localhost) it hands out a port in PORT,
// which vite ignores on its own, and the proxy 502s
const portless = process.env.PORTLESS_URL
  ? { port: Number(process.env.PORT), strictPort: true, host: process.env.HOST }
  : undefined;
// import { ssamTimelapse } from "vite-plugin-ssam-timelapse";

export default defineConfig({
  base: "./",
  server: portless,
  plugins: [
    glsl({
      warnDuplicatedImports: false,
    }),
    ssamExport(),
    ssamFfmpeg(),
    // ssamTimelapse(),
  ],
  clearScreen: false,
  build: {
    outDir: "./dist",
    assetsDir: ".",
    rollupOptions: { input: { main: "index.html", foam: "foam.html", path: "path.html", paper: "paper.html", smoke: "smoke.html", shapes: "shapes.html", swarm: "swarm.html", cage: "cage.html", cagemesh: "cagemesh.html", fill: "fill.html" } },
  },
});
