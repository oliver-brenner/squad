// Dashboard "Muscle activity" hub: interactive body heatmap with per-region
// drill-down, and session-mix category tiles.
// Replaces the old TrainingBreakdown panels on the dashboard.

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { useQuery } from "@powersync/react";
import { Dumbbell, Flame, Flower2, HeartPulse, PersonStanding } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeProfile } from "@/lib/db/decoders";
import type { ProfileRow } from "@/lib/db/schema";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";
import { BodyMap, HEAT_SWATCHES } from "@/components/body-map/body-map";
import type { BodyRegionSlug } from "@/components/body-map/body-data";
import { computeExerciseBreakdown } from "@/lib/stats/exercise-breakdown";
import { MuscleGroupsBody, MuscleLegend } from "@/components/stats/training-breakdown";
import {
  computeCategoryActivity,
  computeMuscleHeatmap,
  TRAINABLE_REGIONS,
  REGION_LABELS,
  type RegionStats,
} from "@/lib/stats/muscle-heatmap";
import { useSetExerciseRows } from "./use-set-exercise-rows";

type Days = 7 | 30 | "all";

const PERIOD_LABEL: Record<string, string> = {
  "7": "last 7 days",
  "30": "last 30 days",
  all: "all time",
};

const CATEGORY_STYLE: Record<
  string,
  { icon: typeof Dumbbell; text: string; bg: string }
> = {
  resistance: { icon: Dumbbell, text: "text-blue-400", bg: "bg-blue-400/10" },
  functional: { icon: PersonStanding, text: "text-emerald-400", bg: "bg-emerald-400/10" },
  conditioning: { icon: Flame, text: "text-orange-400", bg: "bg-orange-400/10" },
  cardio: { icon: HeartPulse, text: "text-violet-400", bg: "bg-violet-400/10" },
  mobility: { icon: Flower2, text: "text-sky-400", bg: "bg-sky-400/10" },
};
// A category re-added after a label collision gets a de-duped key like
// "functional 2" (see ensureUniqueKey in mutations/user-field-options.ts) —
// strip that suffix so the icon/colour still matches the canonical category.
function categoryStyleKey(id: string): string {
  return id.replace(/\s+\d+$/, "");
}

const FALLBACK_CATEGORY_STYLE = {
  icon: Dumbbell,
  text: "text-muted-foreground",
  bg: "bg-muted/40",
};

function fmtVolume(kg: number): string {
  return `${Math.round(kg).toLocaleString()} kg`;
}

function fmtAgo(daysSince: number | null): string {
  if (daysSince === null) return "Never";
  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "1d ago";
  return `${daysSince}d ago`;
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function MuscleActivity() {
  const { user } = useAuth();
  const allRows = useSetExerciseRows();
  const { muscleGroups, categories: categoryOptions } = useUserFieldOptions();
  const [days, setDays] = useState<Days>(7);
  const [selected, setSelected] = useState<BodyRegionSlug | null>(null);

  const { data: profileRows = [] } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [user?.id ?? ""]
  );
  const sex = profileRows[0] ? decodeProfile(profileRows[0]).sex : "male";

  const windowRows = useMemo(() => {
    if (days === "all") return allRows;
    const since = format(subDays(new Date(), days - 1), "yyyy-MM-dd");
    return allRows.filter((r) => r.performedOn >= since);
  }, [allRows, days]);

  const heatmap = useMemo(
    () => computeMuscleHeatmap(windowRows, muscleGroups),
    [windowRows, muscleGroups]
  );
  // All-time pass answers "when did I last hit this?" for cold regions.
  const allTime = useMemo(
    () => computeMuscleHeatmap(allRows, muscleGroups),
    [allRows, muscleGroups]
  );
  const breakdown = useMemo(
    () => computeExerciseBreakdown(windowRows, muscleGroups),
    [windowRows, muscleGroups]
  );
  const categories = useMemo(
    () => computeCategoryActivity(windowRows, categoryOptions),
    [windowRows, categoryOptions]
  );

  // Every trainable region is tappable; cold ones sit at 0 heat.
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

  const ranked = useMemo(
    () =>
      [...heatmap.regions.values()]
        .filter((r) => r.weightedSets > 0)
        .sort((a, b) => b.weightedSets - a.weightedSets),
    [heatmap]
  );

  const hasData = allRows.length > 0;

  return (
    <section className="mt-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Muscle Activity
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {([7, 30, "all"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md w-8 py-1 text-xs font-medium text-center transition-colors ${
                days === d
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d === "all" ? "all" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-4">
        {!hasData ? (
          <p className="text-xs text-muted-foreground">
            Log a workout and your body map lights up here.
          </p>
        ) : (
          <>
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
              <span className="text-[11px] text-muted-foreground">
                {windowRows.length} sets
              </span>
            </div>

            {selected ? (
              <RegionDetail
                stats={heatmap.regions.get(selected) ?? null}
                region={selected}
                allTimeStats={allTime.regions.get(selected) ?? null}
                totalSets={windowRows.length}
                period={PERIOD_LABEL[String(days)]}
              />
            ) : (
              <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                {ranked.length > 0 ? (
                  <>Tap a muscle for details</>
                ) : (
                  <>Nothing logged in this period — tap a muscle to see when you last hit it.</>
                )}
              </div>
            )}

            {heatmap.unmappedLabels.length > 0 && (
              <p className="text-[11px] text-muted-foreground/70">
                Not shown on diagram: {heatmap.unmappedLabels.join(", ")}
              </p>
            )}
          </>
        )}
      </div>

      {hasData && breakdown.muscleGroups.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Muscle groups
            </span>
            <MuscleLegend />
          </div>
          <MuscleGroupsBody data={breakdown} />
        </div>
      )}

      {hasData && categories.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Session mix · {PERIOD_LABEL[String(days)]}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {categories.map((c) => {
              const style = CATEGORY_STYLE[categoryStyleKey(c.id)] ?? FALLBACK_CATEGORY_STYLE;
              const Icon = style.icon;
              const metrics: string[] = [];
              if (c.minutes > 0) metrics.push(fmtMinutes(c.minutes));
              if (c.distanceKm > 0) metrics.push(`${c.distanceKm.toFixed(1)} km`);
              if (c.volumeKg > 0) metrics.push(fmtVolume(c.volumeKg));
              return (
                <div key={c.id} className={`rounded-xl ${style.bg} p-3 flex flex-col gap-1.5`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${style.text}`} />
                    <span className="text-xs font-medium text-foreground/80">{c.label}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-xl font-semibold tabular-nums ${style.text}`}>
                      {c.pctSessions}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      of {c.sessions === 1 ? "session" : "sessions"}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {metrics.length > 0 ? metrics.join(" · ") : `${c.sets} sets`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function RegionDetail({
  stats,
  region,
  allTimeStats,
  totalSets,
  period,
}: {
  stats: RegionStats | null;
  region: BodyRegionSlug;
  allTimeStats: RegionStats | null;
  totalSets: number;
  period: string;
}) {
  const label = REGION_LABELS[region] ?? region;
  const lastTrained = stats?.lastTrained ?? allTimeStats?.lastTrained ?? null;
  const daysSince = useMemo(() => {
    if (!lastTrained) return null;
    const [y, m, d] = lastTrained.split("-").map(Number);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return Math.max(
      0,
      Math.round((midnight.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000)
    );
  }, [lastTrained]);

  if (!stats || stats.sets === 0) {
    return (
      <div className="rounded-xl bg-muted/40 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-[11px] text-muted-foreground">
            last trained {fmtAgo(daysSince).toLowerCase()}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">No sets in the {period}.</p>
      </div>
    );
  }

  const share = totalSets > 0 ? Math.round((stats.sets / totalSets) * 100) : 0;

  return (
    <div className="rounded-xl bg-muted/40 px-3 py-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[11px] text-muted-foreground">
          last trained {fmtAgo(daysSince).toLowerCase()}
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
