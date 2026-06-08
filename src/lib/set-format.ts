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
type TimeUnit = "h" | "min" | "sec";

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
  if (ex.trackTime && s.durationSec != null)
    parts.push(formatDuration(s.durationSec, (ex.timeUnit ?? "min") as TimeUnit));
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

function formatDuration(sec: number, unit: TimeUnit): string {
  if (unit === "sec") return `${sec} secs`;
  if (unit === "min") {
    const mins = Math.round((sec / 60) * 10) / 10;
    return `${mins} mins`;
  }
  const hrs = Math.round((sec / 3600) * 100) / 100;
  return `${hrs} hrs`;
}

function toDisplayDist(km: number, unit: DistanceUnit): number {
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}
