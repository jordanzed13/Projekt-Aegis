import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  main: {
    entry: "src/main/index.ts",
    build: {
      outDir: path.join(__dirname, "dist/main"),
    },
  },
  preload: {
    entry: "src/preload/index.ts",
    build: {
      outDir: path.join(__dirname, "dist/preload"),
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    root: path.join(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      outDir: path.join(__dirname, "dist/renderer"),
    },
  },
});
