import { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } from "@powersync/web";
import { AppSchema } from "./schema";

// Singleton PowerSyncDatabase. Storage lives in IndexedDB (via wa-sqlite's
// IDBBatchAtomicVFS) rather than the default OPFS — IDB is older and more
// resilient on iOS Safari, which aggressively evicts backgrounded tabs and
// can leave OPFS state inconsistent on the next reload.
export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: new WASQLiteOpenFactory({
    dbFilename: "squad.db",
    vfs: WASQLiteVFS.IDBBatchAtomicVFS,
  }),
});
