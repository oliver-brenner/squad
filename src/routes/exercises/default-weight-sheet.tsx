import { useEffect, useState } from "react";

interface Props {
  exerciseName: string;
  // How many past sets carry an entered weight (reps-only sets are excluded —
  // they aren't touched either way).
  setCount: number;
  // (new default − old default), in kg. Null when the amount isn't settled yet:
  // switching the default ON happens before any figure has been typed, so the
  // copy drops the magnitude rather than quoting a number that's about to change.
  deltaKg: number | null;
  // The default weight the exercise will be saved with, for the worked example.
  // Null alongside a null delta.
  newDefaultKg: number | null;
  // Entered weight of the most recent past set, or null if none is known.
  latestWeightKg: number | null;
  busy: boolean;
  onChoose: (applyToHistory: boolean) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Full-width tray row, matching the exercise action tray — with a border and a
// resting fill so both options read as tappable rather than as plain text.
const OPTION =
  "w-full rounded-xl border border-border bg-muted/30 py-4 text-center text-base font-medium transition-colors hover:bg-muted active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60";

// Confirms what happens to already-logged sets when an exercise's default
// weight changes.
//
// The copy is written around the INVARIANT rather than the values, so it reads
// identically whether the past sets are all 100 kg or all different — the
// per-set numbers never need to appear. The one example is taken from a single
// real set (the most recent), which keeps it a true statement rather than a
// summary that would be wrong for mixed history.
export function DefaultWeightSheet({
  exerciseName,
  setCount,
  deltaKg,
  newDefaultKg,
  latestWeightKg,
  busy,
  onChoose,
}: Props) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const plural = setCount === 1 ? "set" : "sets";
  const direction =
    deltaKg === null
      ? "subtracts the default weight from each entered weight"
      : deltaKg > 0
        ? `subtracts ${round2(Math.abs(deltaKg))} kg from each entered weight`
        : `adds ${round2(Math.abs(deltaKg))} kg to each entered weight`;

  // Only worth showing once there's a "+" on the row to explain, and only when
  // both the amount and a real set to quote are known. The adjustment is
  // total-preserving by construction: the entered weight drops by the delta and
  // the new default adds it straight back.
  const example = (() => {
    if (deltaKg === null || newDefaultKg === null || newDefaultKg <= 0) return null;
    if (latestWeightKg === null) return null;
    const entered = round2(latestWeightKg - deltaKg);
    return { entered, total: round2(entered + newDefaultKg) };
  })();

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out"
        style={{ transform: visible ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted" />

        <div className="flex flex-col gap-2 px-5 pt-4">
          <h2 className="text-base font-semibold">Update past sets?</h2>
          <p className="text-sm text-muted-foreground">
            {setCount} past {plural} of {exerciseName}{" "}
            {setCount === 1 ? "was" : "were"} logged under the old default weight.
            Adjusting {setCount === 1 ? "it" : "them"} {direction}, so every set's total
            load stays exactly what you lifted.
            {example && (
              <>
                {" "}
                Your last set stays {example.total} kg, shown as {example.entered}+
                {round2(newDefaultKg ?? 0)}.
              </>
            )}
          </p>
        </div>

        <div
          className="flex flex-col gap-2 px-5 pt-5 pb-5"
          style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        >
          {/* Two equally-weighted choices — neither is the "safe" default, so
              they're styled identically rather than primary/secondary. */}
          <button type="button" disabled={busy} onClick={() => onChoose(true)} className={OPTION}>
            {busy ? "Updating…" : `Adjust past ${plural}`}
          </button>
          <button type="button" disabled={busy} onClick={() => onChoose(false)} className={OPTION}>
            Leave {setCount === 1 ? "it" : "them"} as {setCount === 1 ? "it is" : "they are"}
          </button>
        </div>
      </div>
    </>
  );
}
