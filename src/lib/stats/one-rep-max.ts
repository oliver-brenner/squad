// Epley formula: 1RM = weight * (1 + reps / 30). Reasonable up to ~10 reps.
export function estimateOneRepMax(
  weightKg: number | null,
  reps: number | null
): number | null {
  if (!weightKg || !reps || reps < 1) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}
