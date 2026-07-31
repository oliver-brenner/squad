import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { effectiveLoadKg, recordLoadKg } from "@/lib/set-format";

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
  "reps" | "weightKg" | "bodyweightKg" | "distanceKm" | "durationSec" | "speedMs" | "variation"
>;

function effectiveReps(s: PBInputSet, ex: Exercise): number | null {
  if (s.reps == null || s.reps < 1) return null;
  return ex.doubleReps ? s.reps * 2 : s.reps;
}

// Records score on the weight the lifter added, not the total load: shedding
// assistance (−20 → −10) is a new rep max, and bodyweight is left out so the
// scale doesn't move when they do. See recordLoadKg.
function effectiveWeightKg(s: PBInputSet, ex: Exercise): number | null {
  return recordLoadKg(s, ex);
}

// Volume is work done, not a weight to beat, so it counts the TOTAL load —
// bodyweight included — unlike the rep max above (see recordLoadKg). This keeps
// the Volume badge on the same scale as the session and profile volume totals.
export function setVolumeKg(s: PBInputSet, ex: Exercise): number | null {
  const w = effectiveLoadKg(s, ex);
  const r = effectiveReps(s, ex);
  // A net-negative load (assistance exceeding what it offsets) moved nothing,
  // so it has no volume rather than a negative one.
  if (w == null || w <= 0 || r == null) return null;
  return w * r;
}

// Running-max state for one variation (or the base exercise, key `""`). Each
// variation is a distinct thing to beat a record on — a heavier "close grip"
// bench doesn't touch the plain bench's rep max.
type PBRunningState = {
  maxWeightKg: number | null;
  maxRepsAtMaxWeight: number | null;
  maxVolume: number | null;
  maxDistance: number | null;
  maxDurationSec: number | null;
  maxSpeedMs: number | null;
  maxReps: number | null;
};

function createPBRunningState(): PBRunningState {
  return {
    maxWeightKg: null,
    maxRepsAtMaxWeight: null,
    maxVolume: null,
    maxDistance: null,
    maxDurationSec: null,
    maxSpeedMs: null,
    maxReps: null,
  };
}

// Given an ordered list of sets (oldest → newest), returns a parallel array of
// PB types where EVERY set that established a new max at its point in time is
// flagged — even if a later set has since beaten it. Used by the feed: a PB
// hit on a session is a historical achievement and shouldn't disappear just
// because the user later topped it.
//
// Records are tracked separately PER VARIATION (`s.variation`, `""` for none)
// — each variation competes only against its own history.
export function computeHistoricalPBs<T extends PBInputSet>(
  sets: T[],
  exercise: Exercise,
  { includeTies = false } = {}
): PBType[][] {
  // Use the actual tracking flags rather than user-defined `categories`, since
  // a "resistance" tag isn't required for an exercise to be weight + reps.
  // Including bodyweight does NOT make an exercise strength-scored — only a
  // weight metric does (recordLoadKg explains why).
  const isStrength = exercise.trackReps && !exercise.isBodyweight;
  const tracksDistance = !!exercise.distanceUnit;
  const tracksTime = exercise.trackTime;
  const tracksSpeed = exercise.trackSpeed;

  const statesByVariation = new Map<string, PBRunningState>();
  function stateFor(s: T): PBRunningState {
    const key = s.variation ?? "";
    let st = statesByVariation.get(key);
    if (!st) {
      st = createPBRunningState();
      statesByVariation.set(key, st);
    }
    return st;
  }

  const beats = (a: number, b: number | null) =>
    b == null || (includeTies ? a >= b : a > b);

  // Record every set that established a new max at its point in time.
  // When includeTies is false (feed), ties don't count — a matched record
  // isn't a new achievement. When true (history view), ties move the badge
  // to the most recent holder via the newest-wins pass in computePBsInOrder.
  return sets.map((s) => {
    const pbs: PBType[] = [];
    const state = stateFor(s);

    // Push order mirrors the metric display order on a set row (weight → reps
    // → time → distance) so badges read left-to-right in the same direction.
    if (isStrength) {
      // RM = rep max: the best (heaviest weight, then most reps at that weight).
      // A set earns the badge when it sets a new top weight, or matches the top
      // weight with more reps than any prior set at that weight.
      const w = effectiveWeightKg(s, exercise);
      const r = effectiveReps(s, exercise);
      if (w != null && r != null) {
        const heavier = state.maxWeightKg == null || w > state.maxWeightKg;
        const sameWeightMoreReps =
          state.maxWeightKg != null &&
          w === state.maxWeightKg &&
          beats(r, state.maxRepsAtMaxWeight);
        const tie =
          state.maxWeightKg != null && w === state.maxWeightKg && r === state.maxRepsAtMaxWeight;

        if (beats(w, state.maxWeightKg) || sameWeightMoreReps || (includeTies && tie)) {
          pbs.push("RM");
        }
        // Advance the frontier: a heavier weight resets the reps record to this
        // set's reps; an equal-weight set only bumps it when reps increase.
        if (heavier) {
          state.maxWeightKg = w;
          state.maxRepsAtMaxWeight = r;
        } else if (w === state.maxWeightKg && r > (state.maxRepsAtMaxWeight ?? 0)) {
          state.maxRepsAtMaxWeight = r;
        }
      }
      const vol = setVolumeKg(s, exercise);
      if (vol != null && beats(vol, state.maxVolume)) {
        pbs.push("Volume");
        state.maxVolume = vol;
      }
    }

    // A pure-reps set (only reps logged — no weight, distance, time, or speed)
    // earns an RM too: with no weight, max reps IS the rep max. This catches
    // pullups/pushups, but also weight-tracking exercises where the user just
    // logged reps without weight — the running max only competes across
    // pure-rep sets, so weighted sets don't poison the comparison. This is also
    // where a bodyweight exercise that includes bodyweight lands: its recorded
    // bodyweight feeds volume and the charts, but never the record.
    if (exercise.trackReps) {
      const r = effectiveReps(s, exercise);
      const setIsPureReps =
        r != null &&
        effectiveWeightKg(s, exercise) == null &&
        s.distanceKm == null &&
        s.durationSec == null &&
        s.speedMs == null;
      if (setIsPureReps && beats(r, state.maxReps)) {
        pbs.push("RM");
        state.maxReps = r;
      }
    }

    // "Time" PB = longest duration sustained in a single set. Fires for any
    // exercise that tracks time (treadmill/bike with time+speed, planks, etc.)
    // — distance isn't required, so a slow long run can be a Time PB even
    // when distance was beaten on a different (faster) day.
    if (tracksTime && s.durationSec != null) {
      if (beats(s.durationSec, state.maxDurationSec)) {
        pbs.push("Time");
        state.maxDurationSec = s.durationSec;
      }
    }

    if (tracksSpeed && s.speedMs != null) {
      if (beats(s.speedMs, state.maxSpeedMs)) {
        pbs.push("Speed");
        state.maxSpeedMs = s.speedMs;
      }
    }

    if (tracksDistance && s.distanceKm != null) {
      if (beats(s.distanceKm, state.maxDistance)) {
        pbs.push("Distance");
        state.maxDistance = s.distanceKm;
      }
    }

    return pbs;
  });
}

// Same as computeHistoricalPBs, but applies a newest-wins post-pass that strips
// any earlier PB whose record has since been beaten. The result marks only the
// CURRENT PB-holder per type — used in the exercise history view and the
// read-only session view so a badge means "this is still their record."
//
// Dedup keys on (variation, type): each variation holds its own record per
// type, so a PB on one variation must not strip the flag off another
// variation's still-standing record.
export function computePBsInOrder<T extends PBInputSet>(
  sets: T[],
  exercise: Exercise
): PBType[][] {
  const awarded = computeHistoricalPBs(sets, exercise);
  const seen = new Set<string>();
  for (let i = awarded.length - 1; i >= 0; i--) {
    const variationKey = sets[i].variation ?? "";
    awarded[i] = awarded[i].filter((t) => {
      const key = `${variationKey}::${t}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return awarded;
}
