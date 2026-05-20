import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  subDays,
  format,
  eachDayOfInterval,
  isToday,
  isAfter,
  isBefore,
  isSameMonth,
  parseISO,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
const DEFAULT_LOOKBACK_DAYS = 27;
// Minimum horizontal travel to register as a month swipe — too low and a tap
// drift triggers it; too high and the gesture feels unresponsive.
const SWIPE_THRESHOLD_PX = 50;

export function ActivityCalendar({ sessions }: { sessions: SessionEntry[] }) {
  const navigate = useNavigate();
  const today = new Date();

  // Cap range — earliest month the user can swipe back to is the month of
  // their first logged session (falling back to a default lookback so the
  // first-launch state isn't a single-day grid). Latest is the current month.
  const earliestDate =
    sessions.length > 0
      ? parseISO(sessions[0].performedOn)
      : subDays(today, DEFAULT_LOOKBACK_DAYS);
  const minMonth = startOfMonth(earliestDate);
  const maxMonth = startOfMonth(today);

  const [viewMonth, setViewMonth] = useState<Date>(maxMonth);

  // Build the visible grid for the displayed month: weeks starting Monday,
  // with leading/trailing padding so every row is exactly 7 days. Days
  // outside the current month render as empty cells.
  const gridStart = startOfWeek(viewMonth, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const sessionMap = new Map<string, SessionEntry[]>();
  for (const s of sessions) {
    const arr = sessionMap.get(s.performedOn) ?? [];
    arr.push(s);
    sessionMap.set(s.performedOn, arr);
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

  const canGoBack = isAfter(viewMonth, minMonth);
  const canGoForward = isBefore(viewMonth, maxMonth);

  function goPrev() {
    if (!canGoBack) return;
    setViewMonth((m) => subMonths(m, 1));
  }
  function goNext() {
    if (!canGoForward) return;
    setViewMonth((m) => addMonths(m, 1));
  }

  // Swipe: capture x at touchstart, compare at touchend. Vertical drags still
  // scroll the page because the container declares `touch-action: pan-y` —
  // browser keeps native vertical panning, hands horizontal motion to us.
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  const monthLabel = format(viewMonth, "MMMM yyyy");

  return (
    <>
      <div className="rounded-2xl border border-border bg-card px-3 pt-3 pb-4">
        <div className="mb-2 flex items-center justify-between px-0.5">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoBack}
            className="flex h-6 w-6 items-center justify-center rounded-full text-foreground/80 hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-foreground/80 tabular-nums">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoForward}
            className="flex h-6 w-6 items-center justify-center rounded-full text-foreground/80 hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-2">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className="flex justify-center">
              <span className="text-[10px] font-medium text-muted-foreground/35 tracking-widest uppercase">
                {label}
              </span>
            </div>
          ))}
        </div>

        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: "pan-y" }}
        >
          <div className="flex flex-col gap-0.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => {
                  // Future days (beyond today) and pre-cap days stay blank —
                  // no data could exist for them. Days from neighbouring
                  // months that fall in the active data range render the same
                  // cell as in-month days, just dimmed to distinguish them.
                  if (isAfter(day, today)) {
                    return <div key={di} className="py-1" />;
                  }
                  if (isBefore(day, minMonth)) {
                    return <div key={di} className="py-1" />;
                  }

                  const inMonth = isSameMonth(day, viewMonth);
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

                  const wrappedCell = inMonth ? cell : <div className="opacity-50">{cell}</div>;

                  if (!hasSession) return <div key={di}>{wrappedCell}</div>;

                  return (
                    <button
                      key={di}
                      type="button"
                      onClick={() => handleDayClick(dateStr, daySessions)}
                      className="rounded-md hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={`${format(day, "EEEE d MMMM")} — ${daySessions.length} session${daySessions.length > 1 ? "s" : ""}`}
                    >
                      {wrappedCell}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {trayDate && (
        <SessionPickerTray
          dateLabel={format(parseISO(trayDate), "EEEE d MMMM")}
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
