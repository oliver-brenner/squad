export const SESSION_TYPE_COLOR: Record<string, string> = {
  workout: "bg-blue-500",
  stretch: "bg-violet-500",
  sport: "bg-orange-500",
  lifestyle: "bg-emerald-500",
};

export function sessionTypeColor(type: string): string {
  return SESSION_TYPE_COLOR[type] ?? "bg-muted-foreground";
}
