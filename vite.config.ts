import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stub = path.resolve(__dirname, "./src/lib/db/wa-sqlite-stub.js");

// PowerSync runs SQLite via WebAssembly (@journeyapps/wa-sqlite). It needs
// `exclude` so Vite doesn't try to pre-bundle the Wasm binary, and the worker
// scripts must be served with cross-origin isolation headers in dev.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Service worker that precaches the app shell (index.html + hashed JS/CSS
    // + the wa-sqlite .wasm and PowerSync worker scripts). After the first
    // visit the shell is served from the SW cache instantly and offline, so
    // the boot spinner appears immediately on every launch instead of waiting
    // on a network round-trip for index.html.
    //
    // registerType 'autoUpdate': on each visit the browser re-fetches sw.js,
    // and because the precache manifest (with a fresh index.html revision) is
    // baked into it, any new deploy changes sw.js byte-for-byte → the new
    // shell is installed in the background and picked up on the next launch.
    // Users are at most one launch behind, never permanently stale.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Squad",
        short_name: "Squad",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [{ src: "/favicon.png", sizes: "any", type: "image/png" }],
      },
      workbox: {
        // Include the wa-sqlite .wasm and the PowerSync worker .js files so the
        // whole local-DB stack loads from cache on a cold start.
        globPatterns: ["**/*.{js,css,html,wasm,svg,png,ico,webmanifest}"],
        // The main JS chunk (~1.1MB) and the .wasm (~1.1MB) both exceed
        // Workbox's 2MiB default; raise the ceiling so they're precached.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA fallback: serve the cached index.html for client-side routes
        // when offline. /assets/ are real files, never an app route.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/assets\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      // Keep the SW out of `vite dev` — it would cache modules and fight HMR.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // We only use OPFSCoopSyncVFS, which needs the non-encrypted SYNC
      // wa-sqlite module. Stub every other variant so Rollup doesn't emit
      // their ~6MB of unused .wasm payloads or their VFS JS modules. See
      // src/lib/db/wa-sqlite-stub.js for the rationale and the error
      // message produced if a stubbed variant is ever invoked at runtime.
      "@journeyapps/wa-sqlite/dist/mc-wa-sqlite-async.mjs": stub,
      "@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs": stub,
      "@journeyapps/wa-sqlite/dist/mc-wa-sqlite.mjs": stub,
      "@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js": stub,
      "@journeyapps/wa-sqlite/src/examples/AccessHandlePoolVFS.js": stub,
      "@journeyapps/wa-sqlite/src/examples/OPFSWriteAheadVFS.js": stub,
    },
  },
  optimizeDeps: {
    exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
  },
  worker: {
    format: "es",
  },
});
