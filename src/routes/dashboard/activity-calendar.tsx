import {
  startOfWeek,
  subDays,
  format,
  eachDayOfInterval,
  isToday,
  isBefore,
  isAfter,
} from "date-fns";
import { sessionTypeColor } from "@/lib/session-type-color";

interface DotEntry {
  performedOn: string;
  sessionType: string;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function ActivityCalendar({ dots }: { dots: DotEntry[] }) {
  const today = new Date();
  const rangeStart = subDays(today, 29);
  const gridStart = startOfWeek(rangeStart, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: gridStart, end: today });

  const dotMap = new Map<string, string[]>();
  for (const d of dots) {
    const arr = dotMap.get(d.performedOn) ?? [];
    arr.push(d.sessionType);
    dotMap.set(d.performedOn, arr);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-3 pt-3 pb-4">
      <div className="grid grid-cols-7 mb-2">
        {DAY_LABELS.map((label, i) => (
          <div key={i} className="flex justify-center">
            <span className="text-[10px] font-medium text-muted-foreground/35 tracking-widest uppercase">
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              const inRange = !isBefore(day, rangeStart) && !isAfter(day, today);

              if (!inRange) return <div key={di} className="py-1" />;

              const dateStr = format(day, "yyyy-MM-dd");
              const sessionDots = dotMap.get(dateStr) ?? [];
              const isCurrentDay = isToday(day);
              const hasSession = sessionDots.length > 0;

              return (
                <div key={di} className="flex flex-col items-center gap-[5px] py-1">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] leading-none tabular-nums transition-colors ${
                      isCurrentDay
                        ? "bg-foreground text-background font-semibold"
                        : hasSession
                          ? "text-foreground/80 font-medium"
                          : "text-muted-foreground/25"
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  <div className="flex gap-[3px] h-1.5 items-center">
                    {sessionDots.slice(0, 3).map((type, i) => (
                      <div
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${sessionTypeColor(type)}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
