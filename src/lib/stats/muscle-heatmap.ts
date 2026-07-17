// Aggregates set data into per-body-region heat for the dashboard body map,
// plus category activity rows.
// Pure functions — caller passes fetched rows and the user's muscle taxonomy.
//
// Muscle keys resolve to SVG regions in three tiers:
//   1. static map for canonical seeded keys (plus legacy aliases like 'groin'
//      and the one known custom 'back' group → upper back),
//   2. parent-group fallback for custom children (a child under 'legs' shades
//      the legs regions at reduced weight),
//   3. unmapped — surfaced so the UI can say "not shown on diagram".

import type { SetWithExerciseRow } from "@/lib/db/types";
import type { FieldOption, MuscleGroupNode } from "@/lib/user-field-options";
import type { BodyRegionSlug } from "@/components/body-map/body-data";

export type RegionSide = "front" | "back";
// side undefined → shades the region on both views
export type RegionTarget = { region: BodyRegionSlug; factor: number; side?: RegionSide };

const r = (region: BodyRegionSlug, factor = 1, side?: RegionSide): RegionTarget => ({
  region,
  factor,
  side,
});

// Canonical key → SVG region(s). Group keys spread across their regions at
// reduced factor so a group-level tag reads as diffuse heat, not a hotspot.
const KEY_TO_REGIONS: Record<string, RegionTarget[]> = {
  // shoulders — the deltoid polygons exist on both views, so front/side delts
  // shade only the front silhouette and rear delts only the back
  // neck is a child of shoulders but only shades when tagged specifically
  shoulders: [r("deltoids")],
  "front delts": [r("deltoids", 1, "front")],
  "side delts": [r("deltoids", 1, "front")],
  "rear delts": [r("deltoids", 1, "back")],
  neck: [r("neck")],
  // chest
  chest: [r("chest")],
  "upper chest": [r("chest")],
  "lower chest": [r("chest")],
  // upper back (rear delts are a child of this group, hence the deltoids spread)
  "upper back": [r("upper-back"), r("trapezius", 0.5), r("deltoids", 0.5, "back")],
  lats: [r("upper-back")],
  traps: [r("trapezius")],
  // legacy/custom alias: one user has a custom 'back' group
  back: [r("upper-back"), r("trapezius", 0.5)],
  // arms
  arms: [r("biceps", 0.5), r("triceps", 0.5), r("forearm", 0.5), r("hands", 0.5)],
  biceps: [r("biceps")],
  triceps: [r("triceps")],
  forearms: [r("forearm")],
  grip: [r("hands")],
  // core
  core: [r("abs", 0.5), r("obliques", 0.5), r("lower-back", 0.5)],
  abs: [r("abs")],
  obliques: [r("obliques")],
  "lower back": [r("lower-back")],
  // legs
  // ankles are a child of legs but only shade when tagged specifically
  legs: [
    r("quadriceps", 0.5), r("hamstring", 0.5), r("gluteal", 0.5), r("calves", 0.5),
    r("adductors", 0.5), r("tibialis", 0.5),
  ],
  quads: [r("quadriceps")],
  hamstrings: [r("hamstring")],
  glutes: [r("gluteal")],
  calves: [r("calves")],
  // no dedicated iliopsoas polygon; the front adductor region is the closest
  // visible area to the hip flexors, at reduced weight
  "hip flexors": [r("adductors", 0.5, "front")],
  adductors: [r("adductors")],
  groin: [r("adductors")], // legacy key, renamed 2026-07 but may linger offline
  tibialis: [r("tibialis")],
  ankles: [r("ankles")],
};

// Regions users can actually train — cosmetic silhouette parts excluded.
export const TRAINABLE_REGIONS: BodyRegionSlug[] = [
  "neck", "deltoids", "chest", "trapezius", "upper-back", "lower-back",
  "abs", "obliques", "biceps", "triceps", "forearm", "hands", "gluteal",
  "adductors", "quadriceps", "hamstring", "calves", "tibialis", "ankles",
];

export const REGION_LABELS: Record<string, string> = {
  neck: "Neck",
  deltoids: "Shoulders",
  chest: "Chest",
  trapezius: "Traps",
  "upper-back": "Upper Back",
  "lower-back": "Lower Back",
  abs: "Abs",
  obliques: "Obliques",
  biceps: "Biceps",
  triceps: "Triceps",
  forearm: "Forearms",
  hands: "Grip",
  gluteal: "Glutes",
  adductors: "Adductors",
  quadriceps: "Quads",
  hamstring: "Hamstrings",
  calves: "Calves",
  tibialis: "Tibialis",
  ankles: "Ankles",
};

export type MuscleResolver = {
  resolve: (key: string) => RegionTarget[];
  /** labels of keys that resolved to nothing, for the "not on diagram" note */
  unmapped: Set<string>;
};

// Build a resolver over the user's taxonomy: canonical map first, then a
// custom child inherits its parent group's regions at half weight, then a
// custom group spreads across its children's regions.
export function buildMuscleResolver(muscleGroups: MuscleGroupNode[]): MuscleResolver {
  const childParent = new Map<string, string>();
  const groupChildren = new Map<string, string[]>();
  for (const g of muscleGroups) {
    groupChildren.set(g.key, g.children.map((c) => c.key));
    for (const c of g.children) {
      if (!childParent.has(c.key)) childParent.set(c.key, g.key);
    }
  }
  const labelByKey = new Map<string, string>();
  for (const g of muscleGroups) {
    labelByKey.set(g.key, g.label);
    for (const c of g.children) labelByKey.set(c.key, c.label);
  }

  const unmapped = new Set<string>();
  const cache = new Map<string, RegionTarget[]>();

  function resolve(key: string): RegionTarget[] {
    const cached = cache.get(key);
    if (cached) return cached;
    let out: RegionTarget[] = KEY_TO_REGIONS[key] ?? [];
    if (out.length === 0) {
      const parent = childParent.get(key);
      if (parent && KEY_TO_REGIONS[parent]) {
        out = KEY_TO_REGIONS[parent].map((t) => ({ ...t, factor: t.factor * 0.5 }));
      }
    }
    if (out.length === 0) {
      const children = groupChildren.get(key);
      if (children) {
        const merged = new Map<string, RegionTarget>();
        for (const c of children) {
          for (const t of KEY_TO_REGIONS[c] ?? []) {
            const k = `${t.region}|${t.side ?? "both"}`;
            const prev = merged.get(k);
            if (!prev || prev.factor < t.factor * 0.5) {
              merged.set(k, { ...t, factor: t.factor * 0.5 });
            }
          }
        }
        out = [...merged.values()];
      }
    }
    if (out.length === 0) unmapped.add(labelByKey.get(key) ?? key);
    cache.set(key, out);
    return out;
  }

  return { resolve, unmapped };
}

export type RegionStats = {
  region: BodyRegionSlug;
  label: string;
  weightedSets: number;
  sets: number;
  primarySets: number;
  reps: number;
  volumeKg: number;
  lastTrained: string | null; // performed_on ISO date
  topExercises: { name: string; sets: number }[];
  /** 0..1 heat used for shading, per silhouette view */
  intensityFront: number;
  intensityBack: number;
};

export type MuscleHeatmapStats = {
  regions: Map<BodyRegionSlug, RegionStats>;
  totalSets: number;
  totalVolumeKg: number;
  unmappedLabels: string[];
};

const SECONDARY_WEIGHT = 0.3;

// Heat is relative to the most-trained muscle in the window, so the full
// grey→red range is used every period regardless of training volume — that's
// what makes the shading pronounced. A gamma slightly < 1 gives the low-mid
// range a small lift without pushing everything up into the orange/red zones;
// near-linear keeps the discrete blue/orange/red zones evenly distributed.
const HEAT_GAMMA = 0.8;

export function computeMuscleHeatmap(
  rows: SetWithExerciseRow[],
  muscleGroups: MuscleGroupNode[]
): MuscleHeatmapStats {
  const { resolve, unmapped } = buildMuscleResolver(muscleGroups);

  // When an exercise tags both a group and one of its specific children, the
  // child wins: drop the group key so heat lands only on the tagged muscle
  // instead of smearing across the whole group. A group tagged with no
  // children still spreads across all of its regions.
  const groupChildren = new Map<string, string[]>(
    muscleGroups.map((g) => [g.key, g.children.map((c) => c.key)])
  );
  const dropGroupsWithTaggedChild = (keys: string[], tagged: Set<string>): string[] =>
    keys.filter((k) => {
      const children = groupChildren.get(k);
      return !children || !children.some((c) => c !== k && tagged.has(c));
    });

  type Acc = {
    weightedSets: number;
    weightedFront: number;
    weightedBack: number;
    sets: number;
    primarySets: number;
    reps: number;
    volumeKg: number;
    lastTrained: string | null;
    exerciseSets: Map<string, number>;
    exerciseLastPerformed: Map<string, string>;
  };
  const acc = new Map<BodyRegionSlug, Acc>();
  const get = (region: BodyRegionSlug): Acc => {
    let a = acc.get(region);
    if (!a) {
      a = {
        weightedSets: 0, weightedFront: 0, weightedBack: 0,
        sets: 0, primarySets: 0, reps: 0, volumeKg: 0,
        lastTrained: null, exerciseSets: new Map(), exerciseLastPerformed: new Map(),
      };
      acc.set(region, a);
    }
    return a;
  };

  let totalVolumeKg = 0;
  for (const row of rows) {
    const reps = row.set.reps ?? 0;
    const volume = reps * (row.set.weightKg ?? 0);
    totalVolumeKg += volume;

    // Per set, collect the strongest factor per region and view side across
    // the exercise's primary and secondary muscles so overlapping tags don't
    // double-count. A target with no side hits both views.
    const tagged = new Set([
      ...(row.exercise.muscles ?? []),
      ...(row.exercise.secondaryMuscles ?? []),
    ]);
    type SideHit = { weight: number; primary: boolean };
    const hits = new Map<BodyRegionSlug, { front?: SideHit; back?: SideHit }>();
    const sidesOf = (t: RegionTarget): RegionSide[] =>
      t.side ? [t.side] : ["front", "back"];
    for (const m of dropGroupsWithTaggedChild(row.exercise.muscles ?? [], tagged)) {
      for (const t of resolve(m)) {
        let h = hits.get(t.region);
        if (!h) hits.set(t.region, (h = {}));
        for (const s of sidesOf(t)) {
          const prev = h[s];
          if (!prev || prev.weight < t.factor) h[s] = { weight: t.factor, primary: true };
        }
      }
    }
    for (const m of dropGroupsWithTaggedChild(row.exercise.secondaryMuscles ?? [], tagged)) {
      for (const t of resolve(m)) {
        const w = t.factor * SECONDARY_WEIGHT;
        let h = hits.get(t.region);
        if (!h) hits.set(t.region, (h = {}));
        for (const s of sidesOf(t)) {
          const prev = h[s];
          if (!prev) h[s] = { weight: w, primary: false };
          else if (prev.weight < w) h[s] = { weight: w, primary: prev.primary };
        }
      }
    }

    for (const [region, hit] of hits) {
      const a = get(region);
      const wf = hit.front?.weight ?? 0;
      const wb = hit.back?.weight ?? 0;
      a.weightedFront += wf;
      a.weightedBack += wb;
      a.weightedSets += Math.max(wf, wb);
      const primary = (hit.front?.primary || hit.back?.primary) ?? false;
      a.sets += 1;
      if (primary) a.primarySets += 1;
      a.reps += reps;
      a.volumeKg += volume;
      // "Last trained" only counts sets where the region was a primary muscle.
      if (primary && (a.lastTrained === null || row.performedOn > a.lastTrained)) {
        a.lastTrained = row.performedOn;
      }
      a.exerciseSets.set(row.exercise.name, (a.exerciseSets.get(row.exercise.name) ?? 0) + 1);
      const prevLast = a.exerciseLastPerformed.get(row.exercise.name);
      if (!prevLast || row.performedOn > prevLast) {
        a.exerciseLastPerformed.set(row.exercise.name, row.performedOn);
      }
    }
  }

  const maxWeighted = Math.max(
    1,
    ...[...acc.values()].map((a) => Math.max(a.weightedFront, a.weightedBack))
  );

  const regions = new Map<BodyRegionSlug, RegionStats>();
  for (const [region, a] of acc) {
    regions.set(region, {
      region,
      label: REGION_LABELS[region] ?? region,
      weightedSets: a.weightedSets,
      sets: a.sets,
      primarySets: a.primarySets,
      reps: a.reps,
      volumeKg: a.volumeKg,
      lastTrained: a.lastTrained,
      topExercises: [...a.exerciseSets.entries()]
        .sort(
          (x, y) =>
            (a.exerciseLastPerformed.get(y[0]) ?? "").localeCompare(
              a.exerciseLastPerformed.get(x[0]) ?? ""
            )
        )
        .slice(0, 10)
        .map(([name, sets]) => ({ name, sets })),
      intensityFront: Math.pow(Math.min(1, a.weightedFront / maxWeighted), HEAT_GAMMA),
      intensityBack: Math.pow(Math.min(1, a.weightedBack / maxWeighted), HEAT_GAMMA),
    });
  }

  return {
    regions,
    totalSets: rows.length,
    totalVolumeKg,
    unmappedLabels: [...unmapped].sort(),
  };
}

// --- Category activity -------------------------------------------------------

export type CategoryActivityRow = {
  id: string;
  label: string;
  sessions: number;
  pctSessions: number;
  sets: number;
  minutes: number;
  distanceKm: number;
  volumeKg: number;
};

export function computeCategoryActivity(
  rows: SetWithExerciseRow[],
  categories: FieldOption[]
): CategoryActivityRow[] {
  const labelByKey = new Map(categories.map((c) => [c.key, c.label]));

  type Acc = {
    sessions: Set<string>;
    sets: number;
    seconds: number;
    distanceKm: number;
    volumeKg: number;
  };
  const acc = new Map<string, Acc>();
  const allSessions = new Set<string>();

  for (const row of rows) {
    allSessions.add(row.workoutId);
    for (const cat of row.exercise.categories ?? []) {
      let a = acc.get(cat);
      if (!a) {
        a = { sessions: new Set(), sets: 0, seconds: 0, distanceKm: 0, volumeKg: 0 };
        acc.set(cat, a);
      }
      a.sessions.add(row.workoutId);
      a.sets += 1;
      a.seconds += row.set.durationSec ?? 0;
      a.distanceKm += row.set.distanceKm ?? 0;
      a.volumeKg += (row.set.reps ?? 0) * (row.set.weightKg ?? 0);
    }
  }

  const total = allSessions.size;
  return [...acc.entries()]
    .map(([id, a]) => ({
      id,
      label: labelByKey.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1),
      sessions: a.sessions.size,
      pctSessions: total > 0 ? Math.round((a.sessions.size / total) * 100) : 0,
      sets: a.sets,
      minutes: Math.round(a.seconds / 60),
      distanceKm: a.distanceKm,
      volumeKg: a.volumeKg,
    }))
    .sort((x, y) => y.sessions - x.sessions || y.sets - x.sets);
}
