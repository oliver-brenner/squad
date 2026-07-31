import { useEffect, useMemo, useState } from "react";
import { getExerciseHistory } from "@/lib/db/queries";
import type { Exercise, WorkoutSet, ExerciseHistoryEntry } from "@/lib/db/types";
import { computePBsInOrder, PB_LABEL, type PBType } from "@/lib/stats/set-pbs";
import { formatDuration, formatWeightPart, mToHeight, type HeightUnit } from "@/lib/set-format";
import { PBBadges } from "@/components/pb-badge";

// Order the summary reads in: weight-based records first, then the
// time/distance-based ones — mirrors the metric display order elsewhere.
const PB_SUMMARY_ORDER: PBType[] = ["RM", "Volume", "Distance", "Time", "Speed"];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSet(s: WorkoutSet, ex: Exercise): string {
  const parts: string[] = [];
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";
  const weightPart = formatWeightPart(s, ex);
  if (weightPart) parts.push(weightPart);
  if (ex.trackReps && s.reps != null)
    parts.push(`${s.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && s.durationSec != null) parts.push(formatDuration(s.durationSec));
  if (ex.trackSpeed && s.speedMs != null) {
    const isKmh = (ex.speedUnit ?? "kmh") === "kmh";
    parts.push(isKmh ? `${+(s.speedMs * 3.6).toFixed(1)} km/h` : `${s.speedMs} m/s`);
  }
  if (ex.trackIncline && s.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${s.inclinePct} incline` : `${s.inclinePct}% incline`
    );
  }
  if (ex.trackResistance && s.resistance != null) parts.push(`res ${s.resistance}`);
  if (ex.distanceUnit && s.distanceKm != null) {
    const dist = toDisplayDist(s.distanceKm, distanceUnit);
    parts.push(`${dist} ${distanceUnit}`);
  }
  if (ex.heightUnit && s.heightM != null) {
    const unit = ex.heightUnit as HeightUnit;
    parts.push(`${mToHeight(s.heightM, unit)} ${unit}`);
  }
  if (ex.trackSteps && s.steps != null) parts.push(`${s.steps} steps`);
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  if (ex.trackRpe && s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function toDisplayDist(km: number, unit: "m" | "km" | "yd"): number {
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}

// Renders the value a PB record actually holds — separate from `formatSet`
// since a summary line shows only the metric that earned the record, not
// every field logged against the set.
function formatPBValue(type: PBType, s: FutureSet, ex: Exercise): string {
  switch (type) {
    case "RM": {
      const weightPart = formatWeightPart(s, ex);
      const reps = s.reps != null ? `${s.reps} reps${ex.doubleReps ? " x2" : ""}` : null;
      if (weightPart && reps) return `${weightPart} · ${reps}`;
      return weightPart ?? reps ?? "—";
    }
    case "Volume": {
      const weightPart = formatWeightPart(s, ex);
      const reps = s.reps != null ? `${s.reps} reps${ex.doubleReps ? " x2" : ""}` : null;
      if (weightPart && reps) return `${weightPart} · ${reps}`;
      return weightPart ?? reps ?? "—";
    }
    case "Distance": {
      if (s.distanceKm == null) return "—";
      const unit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";
      return `${toDisplayDist(s.distanceKm, unit)} ${unit}`;
    }
    case "Time":
      return s.durationSec != null ? formatDuration(s.durationSec) : "—";
    case "Speed": {
      if (s.speedMs == null) return "—";
      const isKmh = (ex.speedUnit ?? "kmh") === "kmh";
      return isKmh ? `${+(s.speedMs * 3.6).toFixed(1)} km/h` : `${s.speedMs} m/s`;
    }
  }
}

// `futureSets` represents sets that are chronologically newer than the rows
// rendered here (e.g. sets in the active workout, when this list is shown via
// `excludeWorkoutId`). They aren't displayed, but they ARE folded into PB
// computation so the badge always lands on the current PB-holder rather than
// staying stuck on a historical set whose record has since been beaten.
type FutureSet = {
  reps: number | null;
  weightKg: number | null;
  bodyweightKg: number | null;
  distanceKm: number | null;
  durationSec: number | null;
  speedMs: number | null;
};

interface Props {
  exerciseId: string;
  exercise: Exercise;
  excludeWorkoutId?: string;
  initialEntries?: ExerciseHistoryEntry[];
  futureSets?: FutureSet[];
}

export function ExerciseHistoryList({
  exerciseId,
  exercise,
  excludeWorkoutId,
  initialEntries,
  futureSets,
}: Props) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[] | null>(initialEntries ?? null);
  // Variations live on the exercise itself (key + label), so resolve labels
  // straight from it — friend exercises carry their owner's names already.
  const variationLabels = useMemo(
    () => new Map((exercise.variations ?? []).map((v) => [v.key, v.label])),
    [exercise.variations]
  );

  useEffect(() => {
    if (initialEntries) return;
    getExerciseHistory(exerciseId, excludeWorkoutId).then(setEntries);
  }, [exerciseId, excludeWorkoutId, initialEntries]);

  const { pbsBySetId, currentPBs } = useMemo(() => {
    const map = new Map<string, PBType[]>();
    const current: Partial<Record<PBType, { set: FutureSet; date: string | null }>> = {};
    if (!entries || entries.length === 0) return { pbsBySetId: map, currentPBs: current };
    // entries are newest-first; flatten in chronological order (oldest → newest)
    // so the running-max logic in computePBsInOrder marks the right sets.
    const flat: { set: WorkoutSet; date: string }[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      for (const s of entries[i].sets) flat.push({ set: s, date: entries[i].performedOn });
    }
    // Append future (e.g. active-session) sets so they can claim the latest PB
    // and supersede earlier historical holders. They don't get rendered here.
    const combined: { set: WorkoutSet | FutureSet; date: string | null }[] =
      futureSets && futureSets.length > 0
        ? [...flat, ...futureSets.map((s) => ({ set: s, date: null }))]
        : flat;
    const pbs = computePBsInOrder(
      combined.map((c) => c.set),
      exercise
    );
    flat.forEach((f, i) => {
      if (pbs[i].length > 0) map.set(f.set.id, pbs[i]);
    });
    // computePBsInOrder already resolves ties newest-wins, so at most one
    // set per type survives in `pbs` — that set is the current record holder.
    pbs.forEach((types, i) => {
      for (const t of types) current[t] = { set: combined[i].set, date: combined[i].date };
    });
    return { pbsBySetId: map, currentPBs: current };
  }, [entries, exercise, futureSets]);

  const hasSummary = PB_SUMMARY_ORDER.some((t) => currentPBs[t]);

  return (
    <div className="flex flex-col">
      <div className="overflow-y-auto max-h-72">
        {hasSummary && (
          <div className="px-3 py-2.5 border-b border-border flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">PBs</span>
            <div className="flex flex-col gap-1">
              {PB_SUMMARY_ORDER.map((t) => {
                const rec = currentPBs[t];
                if (!rec) return null;
                return (
                  <div key={t} className="flex items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground text-xs w-10 shrink-0">
                      {PB_LABEL[t]}
                    </span>
                    <span className="flex-1">{formatPBValue(t, rec.set, exercise)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {rec.date ? formatDate(rec.date) : "This session"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {entries === null ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No history yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {entries.map((entry) => {
              const variationKey = entry.sets.find((s) => s.variation)?.variation ?? null;
              const variationLabel = variationKey
                ? variationLabels.get(variationKey) ?? null
                : null;
              return (
              <div key={entry.workoutId} className="px-3 py-2.5 flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {formatDate(entry.performedOn)}
                  {variationLabel && (
                    <span className="text-primary">{" · "}{variationLabel}</span>
                  )}
                </span>
                {entry.sets.map((s, i) => {
                  const pbs = pbsBySetId.get(s.id);
                  return (
                    <div key={s.id} className="flex items-baseline gap-2 text-sm">
                      <span className="text-muted-foreground w-5 shrink-0 text-center text-xs">
                        {i + 1}
                      </span>
                      <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span>
                          {formatSet(s, exercise)}
                          {s.circuitId && (
                            <span className="text-muted-foreground">
                              {" · "}
                              Circuit x{s.circuitRounds ?? 0}
                            </span>
                          )}
                        </span>
                        {pbs && <PBBadges types={pbs} />}
                      </span>
                    </div>
                  );
                })}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
