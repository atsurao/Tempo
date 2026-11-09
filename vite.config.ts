import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The version ships inside the bundle, so the welcome screen and Settings can
// name the running build without asking the shell at runtime.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Tauri expects a fixed dev port and does not want Vite clearing the screen.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
      // Native FSEvents hangs whenever the project lives inside an
      // iCloud-synced ~/Documents: creating a stream makes the OS open every
      // parent directory, and that folder can block indefinitely. Polling
      // never touches FSEvents, so the dev server starts either way. Set
      // VITE_WATCH_FSEVENTS=1 to use native events on a plain local disk.
      usePolling: process.env.VITE_WATCH_FSEVENTS !== "1",
      interval: 300,
    },
  },
  build: {
    target: "safari15",
    sourcemap: false,
  },
});
