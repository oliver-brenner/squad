import type { Exercise, WorkoutSet } from "@/lib/db/types";

// Subset of WorkoutSet that the formatter actually reads. Lets the workout
// editor pass its in-progress `DraftSet` shape too.
export type FormattableSet = Pick<
  WorkoutSet,
  | "reps"
  | "weightKg"
  | "distanceKm"
  | "durationSec"
  | "resistance"
  | "speedMs"
  | "inclinePct"
  | "restSec"
  | "rpe"
>;

export type DistanceUnit = "m" | "km" | "yd";

// Renders a stored duration (always persisted as total seconds) as a compact
// h/m/s string showing only the non-zero components — e.g. "1h 30m", "45s",
// "2m 5s". Time has no per-exercise unit any more: the breakdown is derived
// from the value itself, so only the populated fields appear. Falls back to
// "0s" for an exact zero.
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(" ") : "0s";
}

// Editable h/m/s breakdown used by the set tray. A zero component is null so
// its input renders empty rather than "0".
export type TimeParts = { h: number | null; m: number | null; s: number | null };

export function secToTimeParts(sec: number | null): TimeParts {
  if (sec == null) return { h: null, m: null, s: null };
  const total = Math.max(0, Math.round(sec));
  return {
    h: Math.floor(total / 3600) || null,
    m: Math.floor((total % 3600) / 60) || null,
    s: total % 60 || null,
  };
}

// Recombines tray h/m/s parts into total seconds. All-empty → null so the set
// stores no duration (and can still fall back to a suggested value).
export function timePartsToSec(parts: TimeParts): number | null {
  const { h, m, s } = parts;
  if (h == null && m == null && s == null) return null;
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}

export function formatSetSummary(
  s: FormattableSet,
  ex: Exercise,
  distanceUnit: DistanceUnit
): string {
  const parts: string[] = [];
  if (!ex.isBodyweight && s.weightKg != null) {
    const dw = ex.defaultWeightKg ?? 0;
    parts.push(dw > 0 ? `${s.weightKg}+${dw} kg` : `${s.weightKg} kg`);
  }
  if (ex.trackReps && s.reps != null)
    parts.push(`${s.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && s.durationSec != null) parts.push(formatDuration(s.durationSec));
  if (ex.trackSpeed && s.speedMs != null) {
    const isKmh = (ex.speedUnit ?? "kmh") === "kmh";
    parts.push(isKmh ? `${+(s.speedMs * 3.6).toFixed(1)} km/h` : `${s.speedMs} m/s`);
  }
  if (ex.trackIncline && s.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${s.inclinePct} incline` : `${s.inclinePct}% incline`
    );
  }
  if (ex.trackResistance && s.resistance != null) parts.push(`res ${s.resistance}`);
  if (ex.distanceUnit && s.distanceKm != null) {
    const dist = toDisplayDist(s.distanceKm, distanceUnit);
    parts.push(`${dist} ${distanceUnit}`);
  }
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  if (ex.trackRpe && s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function toDisplayDist(km: number, unit: DistanceUnit): number {
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}
