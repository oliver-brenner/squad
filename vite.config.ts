import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stub = path.resolve(__dirname, "./src/lib/db/wa-sqlite-stub.js");

// PowerSync runs SQLite via WebAssembly (@journeyapps/wa-sqlite). It needs
// `exclude` so Vite doesn't try to pre-bundle the Wasm binary, and the worker
// scripts must be served with cross-origin isolation headers in dev.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
