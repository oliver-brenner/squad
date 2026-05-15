import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./schema";

// Single PowerSyncDatabase instance for the lifetime of the app. The database
// file lives in OPFS (Origin Private File System) — the browser's persistent,
// per-origin filesystem. Wiping site data clears it.
export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: "squad.db",
  },
});
