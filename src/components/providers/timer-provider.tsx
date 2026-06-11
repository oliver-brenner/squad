import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Ephemeral rest/stopwatch timer shared across the whole app. State lives only
// in memory (never synced to PowerSync) — it's a transient logging aid, not
// workout data. Timekeeping is timestamp-based (elapsed derived from Date.now()
// against a stored startedAt) rather than an incrementing counter, so it stays
// accurate when the tab is backgrounded or the device sleeps.

type Mode = "rest" | "free";

interface TimerState {
  // Whether the pinned bar is shown at all.
  active: boolean;
  // "rest" counts up and freezes at targetSec; "free" counts up indefinitely.
  mode: Mode;
  targetSec: number | null;
  // Counting (play) vs paused.
  running: boolean;
  // Epoch ms when the current running segment began (null while paused).
  startedAt: number | null;
  // Elapsed ms accumulated before the current segment (i.e. across pauses).
  baseMs: number;
  // Set once a rest timer reaches its target.
  completed: boolean;
}

const INITIAL: TimerState = {
  active: false,
  mode: "free",
  targetSec: null,
  running: false,
  startedAt: null,
  baseMs: 0,
  completed: false,
};

interface TimerContextValue {
  active: boolean;
  mode: Mode;
  running: boolean;
  completed: boolean;
  elapsedSec: number;
  targetSec: number | null;
  // Start (or replace) a rest countdown-up to `sec`, counting from zero.
  startRest: (sec: number) => void;
  // Start a free stopwatch from zero with no target.
  startFree: () => void;
  // Pause if running, resume if paused. Resuming a completed rest timer turns
  // it into a free timer so it keeps counting past the old target.
  toggle: () => void;
  // Zero the elapsed time and keep counting as a free timer (drops any rest
  // target — a reset timer never stops on its own).
  reset: () => void;
  // Hide and clear the bar (re-shows the "Add timer" box).
  dismiss: () => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

function elapsedMsOf(s: TimerState, now: number): number {
  return s.baseMs + (s.running && s.startedAt != null ? now - s.startedAt : 0);
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TimerState>(INITIAL);
  const [now, setNow] = useState(() => Date.now());

  // Tick only while actively running.
  useEffect(() => {
    if (!state.active || !state.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.active, state.running]);

  // Freeze a rest timer at its target and buzz once when it gets there.
  useEffect(() => {
    if (!state.active || !state.running || state.mode !== "rest" || state.targetSec == null) return;
    if (elapsedMsOf(state, now) >= state.targetSec * 1000) {
      setState((s) => ({
        ...s,
        running: false,
        startedAt: null,
        baseMs: (s.targetSec ?? 0) * 1000,
        completed: true,
      }));
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([200, 100, 200]);
      }
    }
  }, [now, state]);

  const startRest = useCallback((sec: number) => {
    const t = Date.now();
    setNow(t);
    setState({
      active: true,
      mode: "rest",
      targetSec: sec,
      running: true,
      startedAt: t,
      baseMs: 0,
      completed: false,
    });
  }, []);

  const startFree = useCallback(() => {
    const t = Date.now();
    setNow(t);
    // Opens paused at 0:00 — the user starts it with the play button.
    setState({
      active: true,
      mode: "free",
      targetSec: null,
      running: false,
      startedAt: null,
      baseMs: 0,
      completed: false,
    });
  }, []);

  const toggle = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setState((s) => {
      if (!s.active) return s;
      if (s.running) {
        return { ...s, running: false, startedAt: null, baseMs: elapsedMsOf(s, t) };
      }
      // Resuming a finished rest timer continues it as a free count-up.
      return {
        ...s,
        running: true,
        startedAt: t,
        completed: false,
        mode: s.completed ? "free" : s.mode,
        targetSec: s.completed ? null : s.targetSec,
      };
    });
  }, []);

  const reset = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setState((s) => ({
      ...s,
      mode: "free",
      targetSec: null,
      running: true,
      startedAt: t,
      baseMs: 0,
      completed: false,
    }));
  }, []);

  const dismiss = useCallback(() => setState(INITIAL), []);

  const value = useMemo<TimerContextValue>(() => {
    const rawMs = elapsedMsOf(state, now);
    const cappedMs =
      state.mode === "rest" && state.targetSec != null
        ? Math.min(rawMs, state.targetSec * 1000)
        : rawMs;
    return {
      active: state.active,
      mode: state.mode,
      running: state.running,
      completed: state.completed,
      elapsedSec: Math.floor(cappedMs / 1000),
      targetSec: state.targetSec,
      startRest,
      startFree,
      toggle,
      reset,
      dismiss,
    };
  }, [state, now, startRest, startFree, toggle, reset, dismiss]);

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useTimer must be used within a TimerProvider");
  return ctx;
}
