// `rounds` is how many circuit rounds this one set of values was performed for
// (the per-set circuit_rounds). Absent outside a circuit, and on circuit sets
// that span every round — those fall back to the circuit's total.
export type StatSet = { reps: number | null; rounds?: number | null };
export type StatExercise = { sets: StatSet[]; doubleReps: boolean };
export type StatItem =
  | { type: "single"; exercise: StatExercise }
  | { type: "circuit"; rounds: number; exercises: StatExercise[] };

export type SessionStats = { exercises: number; totalSets: number; totalReps: number };

function exerciseStats(ex: StatExercise, rounds = 1): { sets: number; reps: number } {
  const multiplier = ex.doubleReps ? 2 : 1;
  let sets = 0;
  let reps = 0;
  for (const s of ex.sets) {
    const n = s.rounds ?? rounds;
    sets += n;
    reps += (s.reps ?? 1) * multiplier * n;
  }
  return { sets, reps };
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
