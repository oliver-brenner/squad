import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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

interface SessionEntry {
  id: string;
  name: string;
  performedOn: string;
  sessionType: string;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const SESSION_HREF = (id: string) =>
  `/log/${id}?from=${encodeURIComponent("/dashboard")}`;

export function ActivityCalendar({ sessions }: { sessions: SessionEntry[] }) {
  const navigate = useNavigate();
  const today = new Date();
  const rangeStart = subDays(today, 29);
  const gridStart = startOfWeek(rangeStart, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: gridStart, end: today });

  const sessionMap = new Map<string, SessionEntry[]>();
  for (const s of sessions) {
    const arr = sessionMap.get(s.performedOn) ?? [];
    arr.push(s);
    sessionMap.set(s.performedOn, arr);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const [trayDate, setTrayDate] = useState<string | null>(null);
  const traySessions = trayDate ? (sessionMap.get(trayDate) ?? []) : [];

  function handleDayClick(dateStr: string, daySessions: SessionEntry[]) {
    if (daySessions.length === 0) return;
    if (daySessions.length === 1) {
      navigate(SESSION_HREF(daySessions[0].id));
      return;
    }
    setTrayDate(dateStr);
  }

  return (
    <>
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
                const daySessions = sessionMap.get(dateStr) ?? [];
                const isCurrentDay = isToday(day);
                const hasSession = daySessions.length > 0;

                const cell = (
                  <div className="flex flex-col items-center gap-[5px] py-1">
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
                      {daySessions.slice(0, 3).map((s, i) => (
                        <div
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full ${sessionTypeColor(s.sessionType)}`}
                        />
                      ))}
                    </div>
                  </div>
                );

                if (!hasSession) return <div key={di}>{cell}</div>;

                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => handleDayClick(dateStr, daySessions)}
                    className="rounded-md hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`${format(day, "EEEE d MMMM")} — ${daySessions.length} session${daySessions.length > 1 ? "s" : ""}`}
                  >
                    {cell}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {trayDate && (
        <SessionPickerTray
          dateLabel={format(new Date(trayDate), "EEEE d MMMM")}
          sessions={traySessions}
          onSelect={(id) => {
            setTrayDate(null);
            navigate(SESSION_HREF(id));
          }}
          onClose={() => setTrayDate(null)}
        />
      )}
    </>
  );
}

interface TrayProps {
  dateLabel: string;
  sessions: SessionEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

function SessionPickerTray({ dateLabel, sessions, onSelect, onClose }: TrayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out pb-[env(safe-area-inset-bottom)]"
        style={{
          transform: visible ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted" />

        <div className="px-4 pt-3 pb-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {dateLabel}
          </p>
        </div>

        <ul className="flex flex-col px-2 pb-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/60"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(s.sessionType)}`}
                />
                <span className="text-sm font-medium">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
