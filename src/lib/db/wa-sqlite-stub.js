// Build-time stub for wa-sqlite variants we don't use.
//
// PowerSync's vfs.js declares dynamic imports for every wa-sqlite variant
// (sync/async × single/multi-connection) plus every VFS implementation,
// because the choice is runtime-determined. Rollup can't tree-shake those
// dynamic imports, so without intervention the build emits ~7MB of unused
// .wasm files and a handful of unused VFS JS modules.
//
// We only use OPFSCoopSyncVFS (configured in client.ts), which needs:
//   - the non-encrypted sync wa-sqlite WASM
//   - the OPFSCoopSyncVFS implementation
//
// Every other variant is aliased to this stub in vite.config.ts. If anyone
// ever switches VFS without updating the aliases, runtime invocation lands
// on `throwUnused()` and the error message tells them exactly what to fix.

function throwUnused() {
  throw new Error(
    "This wa-sqlite variant was stubbed out at build time. " +
      "See vite.config.ts — remove the matching alias if you need this VFS."
  );
}

export default throwUnused;
export const IDBBatchAtomicVFS = { create: throwUnused };
export const AccessHandlePoolVFS = { create: throwUnused };
export const OPFSWriteAheadVFS = { create: throwUnused };
