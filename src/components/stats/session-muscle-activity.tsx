// Per-session "Muscle activity": the same body heatmap the dashboard shows,
// but scoped to a single session's sets, above the muscle-group breakdown bars.
// Heat is relative to the hardest-hit muscle *in this session*, so the map
// answers "what did this session actually work?" rather than comparing to the
// user's wider history.

import { useMemo, useState } from "react";
import { BodyMap, HEAT_SWATCHES } from "@/components/body-map/body-map";
import type { BodyRegionSlug } from "@/components/body-map/body-data";
import type { SetWithExerciseRow } from "@/lib/db/types";
import type { MuscleGroupNode } from "@/lib/user-field-options";
import type { ExerciseBreakdownStats } from "@/lib/stats/exercise-breakdown";
import {
  computeMuscleHeatmap,
  TRAINABLE_REGIONS,
  REGION_LABELS,
  type RegionStats,
} from "@/lib/stats/muscle-heatmap";
import { MuscleGroupsBody } from "@/components/stats/training-breakdown";

function fmtVolume(kg: number): string {
  return `${Math.round(kg).toLocaleString()} kg`;
}

export function SessionMuscleActivity({
  rows,
  breakdown,
  muscleGroups,
  sex,
}: {
  rows: SetWithExerciseRow[];
  breakdown: ExerciseBreakdownStats;
  muscleGroups: MuscleGroupNode[];
  sex: "male" | "female";
}) {
  const [selected, setSelected] = useState<BodyRegionSlug | null>(null);

  const heatmap = useMemo(
    () => computeMuscleHeatmap(rows, muscleGroups),
    [rows, muscleGroups]
  );

  // Every trainable region stays tappable; untouched ones sit at 0 heat.
  const heat = useMemo(() => {
    const front = new Map<BodyRegionSlug, number>();
    const back = new Map<BodyRegionSlug, number>();
    for (const region of TRAINABLE_REGIONS) {
      front.set(region, 0);
      back.set(region, 0);
    }
    for (const [region, stats] of heatmap.regions) {
      front.set(region, stats.intensityFront);
      back.set(region, stats.intensityBack);
    }
    return { front, back };
  }, [heatmap]);

  return (
    <div className="flex flex-col gap-4">
      <BodyMap sex={sex} heat={heat} selected={selected} onSelect={setSelected} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Less</span>
          <div className="flex h-1.5 w-32 overflow-hidden rounded-full">
            {HEAT_SWATCHES.map((c, i) => (
              <div key={i} className="flex-1" style={{ background: c }} />
            ))}
          </div>
          <span>More</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{rows.length} sets</span>
      </div>

      {selected ? (
        <RegionDetail
          region={selected}
          stats={heatmap.regions.get(selected) ?? null}
          totalSets={rows.length}
        />
      ) : (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          Tap a muscle for details
        </div>
      )}

      {heatmap.unmappedLabels.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          Not shown on diagram: {heatmap.unmappedLabels.join(", ")}
        </p>
      )}

      {breakdown.muscleGroups.length > 0 && (
        <div className="border-t border-border pt-4">
          <MuscleGroupsBody data={breakdown} />
        </div>
      )}
    </div>
  );
}

function RegionDetail({
  region,
  stats,
  totalSets,
}: {
  region: BodyRegionSlug;
  stats: RegionStats | null;
  totalSets: number;
}) {
  const label = REGION_LABELS[region] ?? region;

  if (!stats || stats.sets === 0) {
    return (
      <div className="rounded-xl bg-muted/40 px-3 py-2.5">
        <span className="text-sm font-semibold">{label}</span>
        <p className="mt-1 text-xs text-muted-foreground">Not worked in this session.</p>
      </div>
    );
  }

  const share = totalSets > 0 ? Math.round((stats.sets / totalSets) * 100) : 0;

  return (
    <div className="rounded-xl bg-muted/40 px-3 py-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[11px] text-muted-foreground">
          {stats.primarySets > 0
            ? `${stats.primarySets} primary ${stats.primarySets === 1 ? "set" : "sets"}`
            : "secondary only"}
        </span>
      </div>
      <div className="flex justify-between gap-2">
        {[
          { label: "Sets", value: String(stats.sets) },
          { label: "Reps", value: stats.reps.toLocaleString() },
          { label: "Volume", value: fmtVolume(stats.volumeKg) },
          { label: "Share", value: `${share}%` },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-start">
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
              {s.value}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </span>
          </div>
        ))}
      </div>
      {stats.topExercises.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {stats.topExercises.map((e) => e.name.toLowerCase()).join(" · ")}
        </div>
      )}
    </div>
  );
}
