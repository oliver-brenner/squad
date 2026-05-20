import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { estimateOneRepMax } from "./one-rep-max";

export type PBType = "1RM" | "Volume" | "Distance" | "Reps" | "Time" | "Speed";

export const PB_LABEL: Record<PBType, string> = {
  "1RM": "1RM",
  Volume: "Vol",
  Distance: "Dist",
  Reps: "Reps",
  Time: "Time",
  Speed: "Speed",
};

type PBInputSet = Pick<
  WorkoutSet,
  "reps" | "weightKg" | "distanceKm" | "durationSec" | "speedMs"
>;

function effectiveReps(s: PBInputSet, ex: Exercise): number | null {
  if (s.reps == null || s.reps < 1) return null;
  return ex.doubleReps ? s.reps * 2 : s.reps;
}

function effectiveWeightKg(s: PBInputSet, ex: Exercise): number | null {
  if (ex.isBodyweight) return null;
  if (s.weightKg == null) return null;
  return s.weightKg + (ex.defaultWeightKg ?? 0);
}

export function setOneRm(s: PBInputSet, ex: Exercise): number | null {
  return estimateOneRepMax(effectiveWeightKg(s, ex), effectiveReps(s, ex));
}

export function setVolumeKg(s: PBInputSet, ex: Exercise): number | null {
  const w = effectiveWeightKg(s, ex);
  const r = effectiveReps(s, ex);
  if (w == null || r == null) return null;
  return w * r;
}

// Given an ordered list of sets (oldest → newest), returns a parallel array of
// PB types where ONLY the most recent set that holds each PB type carries that
// badge. Older sets that previously held the record are unbadged so the UI
// shows just the current standing rather than the full progression history.
export function computePBsInOrder<T extends PBInputSet>(
  sets: T[],
  exercise: Exercise
): PBType[][] {
  // Use the actual tracking flags rather than user-defined `categories`, since
  // a "resistance" tag isn't required for an exercise to be weight + reps.
  const isStrength = exercise.trackReps && !exercise.isBodyweight;
  const tracksDistance = !!exercise.distanceUnit;
  const tracksTime = exercise.trackTime;
  const tracksSpeed = exercise.trackSpeed;

  let maxOneRm: number | null = null;
  let maxVolume: number | null = null;
  let maxDistance: number | null = null;
  let maxDurationSec: number | null = null;
  let maxSpeedMs: number | null = null;
  let maxReps: number | null = null;

  // First pass: record every set that established a new max at its point in time.
  // Ties don't count, so subsequent equal-value sets won't steal the badge.
  const awarded: PBType[][] = sets.map((s) => {
    const pbs: PBType[] = [];

    // Push order mirrors the metric display order on a set row (weight → reps
    // → time → distance) so badges read left-to-right in the same direction.
    if (isStrength) {
      const orm = setOneRm(s, exercise);
      if (orm != null && (maxOneRm == null || orm > maxOneRm)) {
        pbs.push("1RM");
        maxOneRm = orm;
      }
      const vol = setVolumeKg(s, exercise);
      if (vol != null && (maxVolume == null || vol > maxVolume)) {
        pbs.push("Volume");
        maxVolume = vol;
      }
    }

    // PB Reps is decided per-set: if the only metric on a set is reps (no
    // weight, distance, time, or speed actually logged), it's eligible. This
    // catches pullups/pushups, but also weight-tracking exercises where the
    // user just logged reps without weight — the running max only competes
    // across pure-rep sets, so weighted sets don't poison the comparison.
    if (exercise.trackReps) {
      const r = effectiveReps(s, exercise);
      const setIsPureReps =
        r != null &&
        effectiveWeightKg(s, exercise) == null &&
        s.distanceKm == null &&
        s.durationSec == null &&
        s.speedMs == null;
      if (setIsPureReps && (maxReps == null || r > maxReps)) {
        pbs.push("Reps");
        maxReps = r;
      }
    }

    // "Time" PB = longest duration sustained in a single set. Fires for any
    // exercise that tracks time (treadmill/bike with time+speed, planks, etc.)
    // — distance isn't required, so a slow long run can be a Time PB even
    // when distance was beaten on a different (faster) day.
    if (tracksTime && s.durationSec != null) {
      if (maxDurationSec == null || s.durationSec > maxDurationSec) {
        pbs.push("Time");
        maxDurationSec = s.durationSec;
      }
    }

    if (tracksSpeed && s.speedMs != null) {
      if (maxSpeedMs == null || s.speedMs > maxSpeedMs) {
        pbs.push("Speed");
        maxSpeedMs = s.speedMs;
      }
    }

    if (tracksDistance && s.distanceKm != null) {
      if (maxDistance == null || s.distanceKm > maxDistance) {
        pbs.push("Distance");
        maxDistance = s.distanceKm;
      }
    }

    return pbs;
  });

  // Second pass (newest → oldest): for each PB type, keep only the most recent
  // awarding. Earlier records get stripped so the badge marks the current holder.
  const seen = new Set<PBType>();
  for (let i = awarded.length - 1; i >= 0; i--) {
    awarded[i] = awarded[i].filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }

  return awarded;
}
