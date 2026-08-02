import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import { supabase } from "@/lib/supabase/client";

// Columns that PowerSync stores as INTEGER (0/1) but Postgres expects as BOOLEAN.
const BOOLEAN_COLUMNS: Record<string, readonly string[]> = {
  exercises: [
    "is_bodyweight",
    "include_bodyweight",
    "track_reps",
    "double_reps",
    "track_time",
    "track_resistance",
    "track_speed",
    "track_incline",
    "track_rest",
    "track_rpe",
  ],
};

// Columns that PowerSync stores as JSON-encoded TEXT but Postgres expects as text[].
// IMPORTANT: any new text[] column added to the schema MUST be listed here, or
// its upload sends a raw JSON string to a text[] column, which Postgres rejects.
// A rejected op throws below and blocks the whole FIFO upload queue behind it.
const ARRAY_COLUMNS: Record<string, readonly string[]> = {
  exercises: ["categories", "muscles", "secondary_muscles", "variations"],
};

// Last upload failure, kept in module state so the Settings → Sync panel can
// show it without devtools. A stuck CRUD queue is invisible from the UI
// otherwise: PowerSync retries the same failing op forever and every write
// behind it in the FIFO queue is blocked.
export type UploadFailure = {
  table: string;
  op: string;
  message: string;
  at: Date;
};

let lastUploadFailure: UploadFailure | null = null;
const uploadFailureListeners = new Set<(f: UploadFailure | null) => void>();

export function getLastUploadFailure(): UploadFailure | null {
  return lastUploadFailure;
}

export function onUploadFailureChange(fn: (f: UploadFailure | null) => void): () => void {
  uploadFailureListeners.add(fn);
  return () => uploadFailureListeners.delete(fn);
}

function setLastUploadFailure(failure: UploadFailure | null): void {
  lastUploadFailure = failure;
  for (const fn of uploadFailureListeners) fn(failure);
}

function encodeForPostgres(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const col of BOOLEAN_COLUMNS[table] ?? []) {
    if (col in out && out[col] !== null && out[col] !== undefined) {
      out[col] = Boolean(out[col]);
    }
  }
  for (const col of ARRAY_COLUMNS[table] ?? []) {
    const v = out[col];
    if (typeof v === "string") {
      try {
        out[col] = JSON.parse(v);
      } catch {
        out[col] = null;
      }
    }
  }
  return out;
}

// PostgREST rejections arrive as { message, code, details, hint } rather than
// Error instances, and the code (e.g. PGRST204 "column not found") is the part
// that actually identifies the problem.
function describeUploadError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message?: string; code?: string; details?: string };
    return [e.code, e.message, e.details].filter(Boolean).join(" — ");
  }
  return String(err);
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  private readonly powerSyncUrl: string;

  constructor(powerSyncUrl: string) {
    this.powerSyncUrl = powerSyncUrl;
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return {
      endpoint: this.powerSyncUrl,
      token: data.session.access_token,
      expiresAt: data.session.expires_at
        ? new Date(data.session.expires_at * 1000)
        : undefined,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const batch = await database.getCrudBatch();
    if (!batch) return;

    for (const op of batch.crud) {
      const table = op.table;
      try {
        switch (op.op) {
          case UpdateType.PUT: {
            const payload = encodeForPostgres(table, { id: op.id, ...op.opData });
            const { error } = await supabase.from(table).upsert(payload);
            if (error) throw error;
            break;
          }
          case UpdateType.PATCH: {
            if (!op.opData) break;
            const payload = encodeForPostgres(table, op.opData);
            const { error } = await supabase
              .from(table)
              .update(payload)
              .eq("id", op.id);
            if (error) throw error;
            break;
          }
          case UpdateType.DELETE: {
            const { error } = await supabase.from(table).delete().eq("id", op.id);
            if (error) throw error;
            break;
          }
        }
      } catch (err) {
        // Surface a clean error so PowerSync retries the whole batch.
        console.error(`[powersync] upload failed for ${op.op} on ${table}:`, err);
        setLastUploadFailure({
          table,
          op: String(op.op),
          message: describeUploadError(err),
          at: new Date(),
        });
        throw err;
      }
    }

    setLastUploadFailure(null);
    await batch.complete();
  }
}
