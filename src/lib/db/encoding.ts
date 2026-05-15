// Conversion helpers between local SQLite cell values and JS types.
//
// PowerSync only knows TEXT/INTEGER/REAL, so:
//   - booleans live as INTEGER 0/1
//   - text[] columns live as JSON-encoded TEXT
//   - timestamps and dates live as ISO strings
//
// Sync rows downloaded from Postgres land in the same shapes — PowerSync
// serialises bool → 0/1 and text[] → JSON string on its way into local SQLite.

export function bool(v: number | null | undefined): boolean {
  return v === 1;
}

// Use when inserting from JS — explicit true/false at the call site.
export function boolInt(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

export function arr(v: string | null | undefined): string[] | null {
  if (v == null) return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function arrStr(v: string[] | null | undefined): string | null {
  if (v == null) return null;
  return JSON.stringify(v);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
