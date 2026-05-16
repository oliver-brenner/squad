import { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } from "@powersync/web";
import { AppSchema } from "./schema";

// Storage lives in OPFS (via wa-sqlite's OPFSCoopSyncVFS) rather than the
// IDBBatchAtomicVFS we used previously. The IDB variant holds batched
// transactions in JS memory and grew the heap continuously on iOS Safari
// under PowerSync's streaming sync — fast enough to OOM-kill the tab in ~30s
// on an iPhone 13 mini. OPFS uses synchronous access handles inside the
// worker, so transaction state never crosses into the main thread's JS heap.
// iOS 17+ supports OPFS reliably (the issues that motivated the original IDB
// choice are no longer present).
export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: new WASQLiteOpenFactory({
    dbFilename: "squad.db",
    vfs: WASQLiteVFS.OPFSCoopSyncVFS,
  }),
});

// Kick off init() the moment this module is imported, in parallel with the
// React boot. By the time the provider's effect needs to await it, the
// wa-sqlite worker is already up and the DB file is open. init() is
// idempotent, so awaiting it again from the provider is a no-op.
export const powerSyncReady: Promise<void> = powersync.init().catch((err) => {
  console.error("[powersync] eager init failed:", err);
  // Surface the failure to the awaiter — the provider will handle retry.
  throw err;
});
