import type { Exercise, WorkoutSet } from "@/lib/db/types";

// Subset of WorkoutSet that the formatter actually reads. Lets the workout
// editor pass its in-progress `DraftSet` shape too.
export type FormattableSet = Pick<
  WorkoutSet,
  | "reps"
  | "weightKg"
  | "bodyweightKg"
  | "distanceKm"
  | "durationSec"
  | "resistance"
  | "speedMs"
  | "inclinePct"
  | "restSec"
  | "rpe"
  | "steps"
  | "heightM"
>;

export type DistanceUnit = "m" | "km" | "yd";
export type HeightUnit = "cm" | "m" | "in" | "ft";

// ----- Load (weight) resolution -----
// One place decides what a set actually loaded, so the summary line, the PB
// engine, the charts, and the receipt can't drift apart.
//
// Three inputs combine:
//   - `set.weightKg`   — what the user entered. NEGATIVE on an assisted
//                        exercise (e.g. -20 kg of assistance on a pull-up).
//   - `ex.defaultWeightKg` — a fixed addition per set (a 20 kg bar).
//   - `set.bodyweightKg`   — the lifter's bodyweight, counted only when the
//                        exercise has `includeBodyweight`.

// The subset of a set the load helpers read. Satisfied by WorkoutSet and by the
// editor's DraftSet.
export type LoadableSet = Pick<WorkoutSet, "weightKg" | "bodyweightKg">;

// Bodyweight contribution of a set: zero unless the exercise includes
// bodyweight AND a positive bodyweight was captured against the set.
export function setBodyweightKg(s: LoadableSet, ex: Exercise): number {
  if (!ex.includeBodyweight) return 0;
  const bw = s.bodyweightKg;
  return typeof bw === "number" && Number.isFinite(bw) && bw > 0 ? bw : 0;
}

// What's added to the entered weight — shown after the "+" on a set row.
function addendKg(s: LoadableSet, ex: Exercise): number {
  return round2((ex.defaultWeightKg ?? 0) + setBodyweightKg(s, ex));
}

// Total kg moved by a set, or null when the set carried no load at all.
// Assistance subtracts, so an assisted set's load is legitimately lower than
// its addend (−20 entered + 80 bodyweight = 60 kg).
//
// An exercise that doesn't track weight (`isBodyweight`) still has a load when
// it includes bodyweight — that's the bodyweight itself. An exercise that DOES
// track weight but had none entered has no load, same as before bodyweight
// existed: a reps-only set stays a reps-only set.
export function effectiveLoadKg(s: LoadableSet, ex: Exercise): number | null {
  const bw = setBodyweightKg(s, ex);
  if (ex.isBodyweight) return bw > 0 ? bw : null;
  if (s.weightKg == null) return null;
  return round2(s.weightKg + (ex.defaultWeightKg ?? 0) + bw);
}

// Load for RECORDS (rep maxes, estimated 1RMs) — as opposed to volume totals,
// which use effectiveLoadKg.
//
// Records deliberately EXCLUDE bodyweight, because bodyweight isn't something
// the lifter is trying to beat. Folding it in makes a record drift with the
// scale: it freezes at their heaviest day and every kg lost reads as strength
// lost, which is backwards for anyone cutting.
//
// So there are two scoring modes:
//   - No weight metric at all → no load; the record is reps (see the pure-reps
//     branch in computeHistoricalPBs).
//   - Weight tracked → score on the weight actually added, which is one
//     continuous axis through zero: -20 assisted → -10 assisted → bodyweight
//     alone → +10 weighted all read as progress in order, at any bodyweight.
//
// Volume is unaffected — reps × total load (bodyweight included) is real work.
export function recordLoadKg(s: LoadableSet, ex: Exercise): number | null {
  if (ex.isBodyweight) return null;
  if (s.weightKg == null) return null;
  return round2(s.weightKg + (ex.defaultWeightKg ?? 0));
}

// The weight metric as it reads on a set row: "60 kg", "60+20 kg",
// "-20+80 kg", or (weight not tracked, bodyweight included) "80 kg".
// Null when the set has no weight metric to show.
export function formatWeightPart(s: LoadableSet, ex: Exercise): string | null {
  const bw = setBodyweightKg(s, ex);
  if (ex.isBodyweight) return bw > 0 ? `${bw} kg` : null;
  if (s.weightKg == null) return null;
  const addend = addendKg(s, ex);
  return addend > 0 ? `${s.weightKg}+${addend} kg` : `${s.weightKg} kg`;
}

// Floating-point addition of kg values (0.5 steps, decimal bodyweights) can
// land on 79.99999999999999; trim it without touching genuine precision.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Heights are stored canonically in metres; convert to the exercise's display
// unit for rendering (mirrors how distance is stored in km).
export function mToHeight(m: number, unit: HeightUnit): number {
  if (unit === "cm") return Math.round(m * 100);
  if (unit === "in") return Math.round(m * 39.3701);
  if (unit === "ft") return +(m * 3.28084).toFixed(1);
  return +m.toFixed(2);
}

export function heightToM(display: number, unit: HeightUnit): number {
  if (unit === "cm") return display / 100;
  if (unit === "in") return display / 39.3701;
  if (unit === "ft") return display / 3.28084;
  return display;
}

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
  const weightPart = formatWeightPart(s, ex);
  if (weightPart) parts.push(weightPart);
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
  if (ex.heightUnit && s.heightM != null) {
    const unit = ex.heightUnit as HeightUnit;
    parts.push(`${mToHeight(s.heightM, unit)} ${unit}`);
  }
  if (ex.trackSteps && s.steps != null) parts.push(`${s.steps} steps`);
  if (ex.trackRpe && s.rpe != null) parts.push(`RPE ${s.rpe}`);
  // Rest is always shown last against the set.
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function toDisplayDist(km: number, unit: DistanceUnit): number {
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}
