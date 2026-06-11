import { useLocation } from "react-router-dom";
import { Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimer } from "@/components/providers/timer-provider";

// The timer is a session-only feature, so the bar only appears on a workout
// session page (/log/:id). A running timer kept alive in the background stays
// hidden elsewhere and reappears here on return.
const SESSION_PATH_RE = /^\/log\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pinned timer module. Rendered just above the bottom nav (see app-layout) and
// only when a timer is active. Reads all state from the TimerProvider.
function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export function TimerBar() {
  const { active, mode, running, completed, elapsedSec, toggle, reset, dismiss } = useTimer();
  const { pathname } = useLocation();

  if (!active || !SESSION_PATH_RE.test(pathname)) return null;

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-2xl items-stretch gap-3 px-4 py-3">
        <div
          className={cn(
            "flex shrink-0 flex-col items-center justify-center gap-0.5",
            completed ? "text-green-600" : "text-muted-foreground"
          )}
        >
          <Timer className="h-5 w-5" />
          <span className="text-[10px] leading-none">
            {mode === "rest"
              ? completed
                ? "Done"
                : "Rest"
              : "Timer"}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <div
            className={cn(
              "font-mono text-5xl font-semibold tabular-nums leading-none",
              completed && "text-green-600"
            )}
          >
            {formatClock(elapsedSec)}
          </div>
        </div>

        {/* All three controls sit in one right-aligned row when there's room,
            wrapping onto extra rows only when the screen is too narrow. */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={toggle}
            aria-label={running ? "Pause" : "Play"}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            {running ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label="Reset"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Discard timer"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
