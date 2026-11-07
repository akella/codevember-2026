import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 5275 },
  build: {
    target: "esnext",
    assetsDir: ".",
    rollupOptions: { input: { main: "index.html", ring: "ring.html" } },
  },
});
