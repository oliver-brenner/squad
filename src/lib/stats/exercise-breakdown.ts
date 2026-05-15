// Computes muscle-group and category breakdown stats for the dashboard widget.
// Pure function — caller passes in fetched sets and muscle group hierarchy.
// Replaces gymtracker's /api/dashboard/exercise-stats route.

import { CATEGORIES } from "@/lib/exercise-options";
import type { SetWithExerciseRow } from "@/lib/db/types";
import type { MuscleGroupNode } from "@/lib/user-field-options";

const CATEGORY_LABELS = new Map(
  CATEGORIES.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)])
);

export type StatRow = { id: string; label: string; count: number; pct: number };
export type MuscleStatRow = StatRow & { primaryPct: number; secondaryPct: number };

export type ExerciseBreakdownStats = {
  muscleGroups: MuscleStatRow[];
  categories: StatRow[];
  totalExercises: number;
};

export function computeExerciseBreakdown(
  rows: SetWithExerciseRow[],
  muscleGroups: MuscleGroupNode[]
): ExerciseBreakdownStats {
  const childToGroups = new Map<string, string[]>();
  const groupKeySet = new Set<string>();
  for (const g of muscleGroups) {
    groupKeySet.add(g.key);
    for (const c of g.children) {
      const arr = childToGroups.get(c.key) ?? [];
      arr.push(g.key);
      childToGroups.set(c.key, arr);
    }
  }

  // Dedupe to unique (workout, exercise) pairs.
  const seen = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    const key = `${r.workoutId}:${r.exercise.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const primaryMuscleGroupCounts = new Map<string, number>();
  const secondaryMuscleGroupCounts = new Map<string, number>();

  function resolveToGroups(muscle: string): string[] {
    if (groupKeySet.has(muscle)) return [muscle];
    return childToGroups.get(muscle) ?? [];
  }

  for (const row of rows) {
    const primaryHits = new Set<string>();
    for (const m of row.exercise.muscles ?? []) {
      for (const g of resolveToGroups(m)) primaryHits.add(g);
    }
    const secondaryHits = new Set<string>();
    for (const m of row.exercise.secondaryMuscles ?? []) {
      for (const g of resolveToGroups(m)) secondaryHits.add(g);
    }
    for (const g of primaryHits)
      primaryMuscleGroupCounts.set(g, (primaryMuscleGroupCounts.get(g) ?? 0) + 1);
    for (const g of secondaryHits)
      secondaryMuscleGroupCounts.set(g, (secondaryMuscleGroupCounts.get(g) ?? 0) + 1);
  }

  const categorySessions = new Map<string, Set<string>>();
  for (const row of uniqueRows) {
    for (const cat of row.exercise.categories ?? []) {
      if (!categorySessions.has(cat)) categorySessions.set(cat, new Set());
      categorySessions.get(cat)!.add(row.workoutId);
    }
  }
  const totalSessions = new Set(uniqueRows.map((r) => r.workoutId)).size;

  const totalPrimary = Array.from(primaryMuscleGroupCounts.values()).reduce((a, b) => a + b, 0);
  const totalSecondary = Array.from(secondaryMuscleGroupCounts.values()).reduce((a, b) => a + b, 0);
  const totalMuscle = totalPrimary + totalSecondary;

  const muscleGroupStats: MuscleStatRow[] = muscleGroups
    .map((g) => {
      const pCount = primaryMuscleGroupCounts.get(g.key) ?? 0;
      const sCount = secondaryMuscleGroupCounts.get(g.key) ?? 0;
      return {
        id: g.key,
        label: g.label,
        count: pCount + sCount,
        primaryPct: totalMuscle > 0 ? Math.round((pCount / totalMuscle) * 100) : 0,
        secondaryPct: totalMuscle > 0 ? Math.round((sCount / totalMuscle) * 100) : 0,
        pct: totalMuscle > 0 ? Math.round(((pCount + sCount) / totalMuscle) * 100) : 0,
      };
    })
    .filter((g) => g.count > 0)
    .sort((a, b) => b.primaryPct - a.primaryPct);

  const categories: StatRow[] = CATEGORIES.map((c) => {
    const sessionCount = categorySessions.get(c)?.size ?? 0;
    return {
      id: c,
      label: CATEGORY_LABELS.get(c) ?? c,
      count: sessionCount,
      pct: totalSessions > 0 ? Math.round((sessionCount / totalSessions) * 100) : 0,
    };
  })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return { muscleGroups: muscleGroupStats, categories, totalExercises: uniqueRows.length };
}
