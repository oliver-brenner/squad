import { useState, useTransition, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateWorkoutCalories } from "@/lib/mutations/workouts";

// Bottom-sheet for entering a session's total calories. Shared by the workout
// editor's calories pill. Saves directly via updateWorkoutCalories and reports
// the saved value back so the caller can update its pill without a refetch.
export function CalorieTray({
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
  const [draft, setDraft] = useState(current != null ? String(current) : "");
  const [visible, setVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function save() {
    const trimmed = draft.trim();
    const value = trimmed === "" ? null : Math.max(0, Math.round(Number(trimmed)));
    if (trimmed !== "" && (value == null || !Number.isFinite(value))) return;
    startTransition(async () => {
      try {
        await updateWorkoutCalories({ id: workoutId, calories: value });
        onSaved(value);
      } catch (err) {
        console.error("[calorie-tray] updateWorkoutCalories failed:", err);
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
          <h2 className="font-semibold">Session calories</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Calories</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                }}
                placeholder="300"
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-sm text-muted-foreground">kcal</span>
            </div>
          </div>
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
