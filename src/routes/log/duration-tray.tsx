import { useState, useTransition, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateWorkoutDuration } from "@/lib/mutations/workouts";

const MAX_DURATION_SEC = 86_400;

// Hours + minutes breakdown of a stored total. A zero component is null so its
// input renders empty rather than "0".
type HourMinute = { h: number | null; m: number | null };

function secToHourMinute(sec: number | null): HourMinute {
  if (sec == null) return { h: null, m: null };
  const totalMin = Math.max(0, Math.round(sec / 60));
  return { h: Math.floor(totalMin / 60) || null, m: totalMin % 60 || null };
}

// Bottom-sheet for entering a session's total time as hours + minutes. Mirrors
// CalorieTray (shared by the workout editor's time pill): saves directly via
// updateWorkoutDuration and reports the saved total-seconds value back so the
// caller can update its pill without a refetch.
export function DurationTray({
  workoutId,
  current,
  onClose,
  onSaved,
}: {
  workoutId: string;
  current: number | null;
  onClose: () => void;
  onSaved: (value: number | null) => void;
}) {
  const [parts, setParts] = useState<HourMinute>(() => secToHourMinute(current));
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function patch(p: Partial<HourMinute>) {
    setParts((prev) => ({ ...prev, ...p }));
  }

  function save() {
    // Both fields empty clears the value; anything else is clamped to the 24h
    // the mutation accepts so a fat-fingered "999" hours doesn't throw on parse.
    const { h, m } = parts;
    const value =
      h == null && m == null
        ? null
        : Math.min(MAX_DURATION_SEC, (h ?? 0) * 3600 + (m ?? 0) * 60);
    startTransition(async () => {
      try {
        await updateWorkoutDuration({ id: workoutId, durationSec: value });
        onSaved(value);
      } catch (err) {
        console.error("[duration-tray] updateWorkoutDuration failed:", err);
      }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="font-semibold">Session time</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-4 grid grid-cols-2 gap-3">
          <TimeField
            label="Hours"
            unit="h"
            value={parts.h}
            step={1}
            autoFocus
            onChange={(v) => patch({ h: v })}
            onEnter={save}
          />
          <TimeField
            label="Minutes"
            unit="m"
            value={parts.m}
            step={5}
            onChange={(v) => patch({ m: v })}
            onEnter={save}
          />
        </div>
        <div className="px-4 pb-8">
          <Button onClick={save} className="w-full" size="lg" disabled={pending}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function TimeField({
  label,
  unit,
  value,
  step,
  autoFocus,
  onChange,
  onEnter,
}: {
  label: string;
  unit: string;
  value: number | null;
  step: number;
  autoFocus?: boolean;
  onChange: (value: number | null) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step={step}
          value={value == null ? "" : String(value)}
          autoFocus={autoFocus}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") return onChange(null);
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            onChange(Math.max(0, Math.round(n)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="0"
          className="w-full min-w-0 rounded-lg border border-border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
