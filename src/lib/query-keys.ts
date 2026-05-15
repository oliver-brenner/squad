export const queryKeys = {
  sessions: ["sessions"] as const,
  dashboard: ["dashboard"] as const,
  exercises: ["exercises"] as const,
  workout: (id: string) => ["workout", id] as const,
  exerciseStats: (days: number | "all") => ["exerciseStats", days] as const,
};
