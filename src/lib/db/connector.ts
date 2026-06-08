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
        throw err;
      }
    }

    await batch.complete();
  }
}
