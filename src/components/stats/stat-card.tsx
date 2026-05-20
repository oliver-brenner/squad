import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

function compactValueSize(value: React.ReactNode): string {
  const len = typeof value === "string" ? value.length : typeof value === "number" ? String(value).length : 5;
  if (len <= 9) return "text-sm";
  if (len <= 11) return "text-xs";
  return "text-[10px]";
}

export function StatCard({ label, value, sub, className, compact }: StatCardProps) {
  return (
    <Card className={cn(compact ? "p-2 flex flex-col gap-0.5 items-center text-center" : "p-4 flex flex-col gap-1", className)}>
      <span className={cn("font-medium uppercase tracking-wide text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        {label}
      </span>
      <span className={cn("font-semibold leading-tight tracking-tight whitespace-nowrap", compact ? compactValueSize(value) : "text-2xl")}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </Card>
  );
}
