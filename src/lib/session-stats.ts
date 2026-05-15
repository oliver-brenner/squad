export type StatSet = { reps: number | null };
export type StatExercise = { sets: StatSet[]; doubleReps: boolean };
export type StatItem =
  | { type: "single"; exercise: StatExercise }
  | { type: "circuit"; rounds: number; exercises: StatExercise[] };

export type SessionStats = { exercises: number; totalSets: number; totalReps: number };

function exerciseStats(ex: StatExercise, rounds = 1): { sets: number; reps: number } {
  const multiplier = ex.doubleReps ? 2 : 1;
  return {
    sets: ex.sets.length * rounds,
    reps: ex.sets.reduce((n, s) => n + (s.reps ?? 1) * multiplier, 0) * rounds,
  };
}

export function computeSessionStats(items: StatItem[]): SessionStats {
  let exercises = 0;
  let totalSets = 0;
  let totalReps = 0;
  for (const item of items) {
    if (item.type === "single") {
      exercises++;
      const s = exerciseStats(item.exercise);
      totalSets += s.sets;
      totalReps += s.reps;
    } else {
      exercises += item.exercises.length;
      for (const ex of item.exercises) {
        const s = exerciseStats(ex, item.rounds);
        totalSets += s.sets;
        totalReps += s.reps;
      }
    }
  }
  return { exercises, totalSets, totalReps };
}
