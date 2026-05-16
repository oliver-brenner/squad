import type {
  ExerciseBreakdownStats,
  MuscleStatRow,
  StatRow,
} from "@/lib/stats/exercise-breakdown";

const CATEGORY_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  resistance: { bar: "bg-blue-400/55", text: "text-blue-400/75", bg: "bg-blue-400/10" },
  functional: { bar: "bg-emerald-400/55", text: "text-emerald-400/75", bg: "bg-emerald-400/10" },
  conditioning: { bar: "bg-orange-400/55", text: "text-orange-400/75", bg: "bg-orange-400/10" },
  cardio: { bar: "bg-violet-400/55", text: "text-violet-400/75", bg: "bg-violet-400/10" },
  mobility: { bar: "bg-sky-400/55", text: "text-sky-400/75", bg: "bg-sky-400/10" },
};

const FALLBACK_COLOR = {
  bar: "bg-muted-foreground/40",
  text: "text-muted-foreground/60",
  bg: "bg-muted/40",
};

const PRIMARY_MUSCLE_COLOR = {
  bar: "bg-blue-700/60",
  text: "text-blue-500",
  swatch: "bg-blue-700/60",
};
const SECONDARY_MUSCLE_COLOR = {
  bar: "bg-teal-600/60",
  text: "text-teal-500",
  swatch: "bg-teal-600/60",
};

function MuscleBreakdownRow({ row, maxCombined }: { row: MuscleStatRow; maxCombined: number }) {
  const combined = row.primaryPct + row.secondaryPct;
  const barWidth = maxCombined > 0 ? (combined / maxCombined) * 100 : 0;
  const primaryWidth = combined > 0 ? (row.primaryPct / combined) * 100 : 0;
  const secondaryWidth = combined > 0 ? (row.secondaryPct / combined) * 100 : 0;
  return (
    <>
      <span className="text-sm font-medium text-foreground/80 truncate">{row.label}</span>
      <div className="h-1.5 rounded-full bg-muted/40">
        <div
          className="h-full rounded-full overflow-hidden flex"
          style={{ width: `${barWidth}%` }}
        >
          {row.primaryPct > 0 && (
            <div
              className={`h-full ${PRIMARY_MUSCLE_COLOR.bar}`}
              style={{ width: `${primaryWidth}%` }}
            />
          )}
          {row.secondaryPct > 0 && (
            <div
              className={`h-full ${SECONDARY_MUSCLE_COLOR.bar}`}
              style={{ width: `${secondaryWidth}%` }}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs">
        {row.primaryPct > 0 && (
          <span className={`font-semibold tabular-nums ${PRIMARY_MUSCLE_COLOR.text}`}>
            {row.primaryPct}%
          </span>
        )}
        {row.secondaryPct > 0 && (
          <span className={`font-semibold tabular-nums ${SECONDARY_MUSCLE_COLOR.text}`}>
            {row.secondaryPct}%
          </span>
        )}
      </div>
    </>
  );
}

function BreakdownRow({
  row,
  colorMap,
  maxPct,
}: {
  row: StatRow;
  colorMap: Record<string, { bar: string; text: string; bg: string }>;
  maxPct: number;
}) {
  const colors = colorMap[row.id] ?? FALLBACK_COLOR;
  const barWidth = maxPct > 0 ? (row.pct / maxPct) * 100 : 0;
  return (
    <>
      <span className="text-sm font-medium text-foreground/80 truncate">{row.label}</span>
      <div className={`h-1.5 rounded-full ${colors.bg}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${colors.text}`}>{row.pct}%</span>
    </>
  );
}

function MuscleLegend({ size = "md" }: { size?: "sm" | "md" }) {
  const textClass = size === "sm" ? "text-[11px]" : "text-xs";
  const swatchClass = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  return (
    <div className={`flex items-center gap-2.5 ${textClass} text-muted-foreground`}>
      <span className="flex items-center gap-1">
        <span className={`inline-block ${swatchClass} rounded-sm ${PRIMARY_MUSCLE_COLOR.swatch}`} />
        Primary
      </span>
      <span className="flex items-center gap-1">
        <span
          className={`inline-block ${swatchClass} rounded-sm ${SECONDARY_MUSCLE_COLOR.swatch}`}
        />
        Secondary
      </span>
    </div>
  );
}

export function MuscleGroupsBody({ data }: { data: ExerciseBreakdownStats }) {
  const maxCombined = Math.max(
    ...data.muscleGroups.map((r) => r.primaryPct + r.secondaryPct),
    1
  );
  return (
    <div
      className="grid items-center gap-x-2 gap-y-2.5"
      style={{ gridTemplateColumns: "auto 1fr auto" }}
    >
      {data.muscleGroups.map((row) => (
        <MuscleBreakdownRow key={row.id} row={row} maxCombined={maxCombined} />
      ))}
    </div>
  );
}

export { MuscleLegend };

export function TrainingBreakdownPanels({
  data,
  emptyMessage = "No exercise data for this period.",
  showCategories = true,
}: {
  data: ExerciseBreakdownStats;
  emptyMessage?: string;
  showCategories?: boolean;
}) {
  if (data.totalExercises === 0) {
    return <p className="text-xs text-muted-foreground px-1">{emptyMessage}</p>;
  }

  const maxCombined = Math.max(
    ...data.muscleGroups.map((r) => r.primaryPct + r.secondaryPct),
    1
  );
  const maxPct = Math.max(...data.categories.map((r) => r.pct), 1);

  return (
    <div className={`grid grid-cols-1 gap-3 ${showCategories ? "sm:grid-cols-2" : ""}`}>
      <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Muscle groups
          </span>
          <MuscleLegend />
        </div>
        <div
          className="grid items-center gap-x-2 gap-y-2.5"
          style={{ gridTemplateColumns: "auto 1fr auto" }}
        >
          {data.muscleGroups.map((row) => (
            <MuscleBreakdownRow key={row.id} row={row} maxCombined={maxCombined} />
          ))}
        </div>
      </div>

      {showCategories && (
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Exercise type
          </span>
          <div
            className="grid items-center gap-x-2 gap-y-2.5"
            style={{ gridTemplateColumns: "auto 1fr auto" }}
          >
            {data.categories.map((row) => (
              <BreakdownRow key={row.id} row={row} colorMap={CATEGORY_COLORS} maxPct={maxPct} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
