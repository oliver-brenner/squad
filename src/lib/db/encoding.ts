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

// Exercise variations live as a jsonb array of {key,label} on the exercise.
// Locally PowerSync stores jsonb as JSON text, so decode/encode mirror arr/arrStr
// but validate the object shape and drop malformed entries.
export function decodeVariations(
  v: string | null | undefined
): { key: string; label: string }[] | null {
  if (v == null) return null;
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return null;
    const out = parsed.flatMap((e) => {
      // jsonb rows arrive as objects; a text[] column (pre-migration, or a
      // sync round-trip through PostgREST) double-encodes each entry as a JSON
      // string — tolerate both.
      let obj = e;
      if (typeof obj === "string") {
        try {
          obj = JSON.parse(obj);
        } catch {
          return [];
        }
      }
      return obj && typeof obj === "object" && typeof obj.key === "string" && typeof obj.label === "string"
        ? [{ key: obj.key, label: obj.label }]
        : [];
    });
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function variationsStr(
  v: { key: string; label: string }[] | null | undefined
): string | null {
  if (v == null || v.length === 0) return null;
  return JSON.stringify(v);
}

// Some Postgres text[] values arrive as raw array literals (e.g. `{barbell}`
// or `{"big lifts"}`) rather than JSON-encoded strings — this happens when
// PowerSync streams down a column the client expects to be a scalar text.
// Historically gymtracker stored `exercises.equipment` as text[] even though
// the app uses it as a single value, and inserts done outside the client can
// leak the same shape. This helper normalises both forms back to a plain
// string: passthrough for plain text, first element for an array literal,
// `null` for an empty array literal.
export function unwrapPgArrayLiteral(v: string | null | undefined): string | null {
  if (v == null) return null;
  if (v.length < 2 || v[0] !== "{" || v[v.length - 1] !== "}") return v;
  const inner = v.slice(1, -1);
  if (inner === "") return null;
  // Take the first element. Quoted form (`"foo bar"`) → unquote and unescape.
  const first = splitFirstArrayElement(inner);
  if (first.length >= 2 && first.startsWith('"') && first.endsWith('"')) {
    return first.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return first || null;
}

function splitFirstArrayElement(inner: string): string {
  // Quoted strings can contain escaped quotes and commas — naive split on `,`
  // would butcher them. Walk char-by-char until the first unquoted comma.
  let inQuote = false;
  let escape = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) return inner.slice(0, i);
  }
  return inner;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
