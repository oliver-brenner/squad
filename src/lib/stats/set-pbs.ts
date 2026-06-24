import type { Exercise, WorkoutSet } from "@/lib/db/types";

export type PBType = "RM" | "Volume" | "Distance" | "Time" | "Speed";

export const PB_LABEL: Record<PBType, string> = {
  RM: "RM",
  Volume: "Vol",
  Distance: "Dist",
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

export function setVolumeKg(s: PBInputSet, ex: Exercise): number | null {
  const w = effectiveWeightKg(s, ex);
  const r = effectiveReps(s, ex);
  if (w == null || r == null) return null;
  return w * r;
}

// Given an ordered list of sets (oldest → newest), returns a parallel array of
// PB types where EVERY set that established a new max at its point in time is
// flagged — even if a later set has since beaten it. Used by the feed: a PB
// hit on a session is a historical achievement and shouldn't disappear just
// because the user later topped it.
export function computeHistoricalPBs<T extends PBInputSet>(
  sets: T[],
  exercise: Exercise,
  { includeTies = false } = {}
): PBType[][] {
  // Use the actual tracking flags rather than user-defined `categories`, since
  // a "resistance" tag isn't required for an exercise to be weight + reps.
  const isStrength = exercise.trackReps && !exercise.isBodyweight;
  const tracksDistance = !!exercise.distanceUnit;
  const tracksTime = exercise.trackTime;
  const tracksSpeed = exercise.trackSpeed;

  let maxWeightKg: number | null = null;
  let maxRepsAtMaxWeight: number | null = null;
  let maxVolume: number | null = null;
  let maxDistance: number | null = null;
  let maxDurationSec: number | null = null;
  let maxSpeedMs: number | null = null;
  let maxReps: number | null = null;

  const beats = (a: number, b: number | null) =>
    b == null || (includeTies ? a >= b : a > b);

  // Record every set that established a new max at its point in time.
  // When includeTies is false (feed), ties don't count — a matched record
  // isn't a new achievement. When true (history view), ties move the badge
  // to the most recent holder via the newest-wins pass in computePBsInOrder.
  return sets.map((s) => {
    const pbs: PBType[] = [];

    // Push order mirrors the metric display order on a set row (weight → reps
    // → time → distance) so badges read left-to-right in the same direction.
    if (isStrength) {
      // RM = rep max: the best (heaviest weight, then most reps at that weight).
      // A set earns the badge when it sets a new top weight, or matches the top
      // weight with more reps than any prior set at that weight.
      const w = effectiveWeightKg(s, exercise);
      const r = effectiveReps(s, exercise);
      if (w != null && r != null) {
        const heavier = maxWeightKg == null || w > maxWeightKg;
        const sameWeightMoreReps =
          maxWeightKg != null && w === maxWeightKg && beats(r, maxRepsAtMaxWeight);
        const tie =
          maxWeightKg != null && w === maxWeightKg && r === maxRepsAtMaxWeight;

        if (beats(w, maxWeightKg) || sameWeightMoreReps || (includeTies && tie)) {
          pbs.push("RM");
        }
        // Advance the frontier: a heavier weight resets the reps record to this
        // set's reps; an equal-weight set only bumps it when reps increase.
        if (heavier) {
          maxWeightKg = w;
          maxRepsAtMaxWeight = r;
        } else if (w === maxWeightKg && r > (maxRepsAtMaxWeight ?? 0)) {
          maxRepsAtMaxWeight = r;
        }
      }
      const vol = setVolumeKg(s, exercise);
      if (vol != null && beats(vol, maxVolume)) {
        pbs.push("Volume");
        maxVolume = vol;
      }
    }

    // A pure-reps set (only reps logged — no weight, distance, time, or speed)
    // earns an RM too: with no weight, max reps IS the rep max. This catches
    // pullups/pushups, but also weight-tracking exercises where the user just
    // logged reps without weight — the running max only competes across
    // pure-rep sets, so weighted sets don't poison the comparison.
    if (exercise.trackReps) {
      const r = effectiveReps(s, exercise);
      const setIsPureReps =
        r != null &&
        effectiveWeightKg(s, exercise) == null &&
        s.distanceKm == null &&
        s.durationSec == null &&
        s.speedMs == null;
      if (setIsPureReps && beats(r, maxReps)) {
        pbs.push("RM");
        maxReps = r;
      }
    }

    // "Time" PB = longest duration sustained in a single set. Fires for any
    // exercise that tracks time (treadmill/bike with time+speed, planks, etc.)
    // — distance isn't required, so a slow long run can be a Time PB even
    // when distance was beaten on a different (faster) day.
    if (tracksTime && s.durationSec != null) {
      if (beats(s.durationSec, maxDurationSec)) {
        pbs.push("Time");
        maxDurationSec = s.durationSec;
      }
    }

    if (tracksSpeed && s.speedMs != null) {
      if (beats(s.speedMs, maxSpeedMs)) {
        pbs.push("Speed");
        maxSpeedMs = s.speedMs;
      }
    }

    if (tracksDistance && s.distanceKm != null) {
      if (beats(s.distanceKm, maxDistance)) {
        pbs.push("Distance");
        maxDistance = s.distanceKm;
      }
    }

    return pbs;
  });
}

// Same as computeHistoricalPBs, but applies a newest-wins post-pass that strips
// any earlier PB whose record has since been beaten. The result marks only the
// CURRENT PB-holder per type — used in the exercise history view and the
// read-only session view so a badge means "this is still their record."
export function computePBsInOrder<T extends PBInputSet>(
  sets: T[],
  exercise: Exercise
): PBType[][] {
  const awarded = computeHistoricalPBs(sets, exercise);
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
