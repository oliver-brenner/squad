import { useState, useTransition, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import type { Exercise } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { createExercise, updateExercise } from "@/lib/mutations/exercises";
import { getExerciseById } from "@/lib/db/queries";
import { useUserFieldOptions } from "@/components/providers/user-field-options-provider";

type Metric =
  | "reps"
  | "weight"
  | "time"
  | "speed"
  | "incline"
  | "resistance"
  | "distance"
  | "rest"
  | "calories"
  | "rpe";
type DistanceUnit = "m" | "km" | "yd";
type InclineUnit = "pct" | "setting";
type SpeedUnit = "ms" | "kmh";

const DISTANCE_UNITS: { value: DistanceUnit; label: string }[] = [
  { value: "m", label: "Meters" },
  { value: "km", label: "Kilometers" },
  { value: "yd", label: "Yards" },
];

const INCLINE_UNITS: { value: InclineUnit; label: string }[] = [
  { value: "pct", label: "Percentage" },
  { value: "setting", label: "Setting" },
];

const SPEED_UNITS: { value: SpeedUnit; label: string }[] = [
  { value: "ms", label: "m/s" },
  { value: "kmh", label: "km/h" },
];

const METRICS: Metric[] = [
  "weight",
  "reps",
  "time",
  "speed",
  "incline",
  "resistance",
  "distance",
  "rest",
  "calories",
  "rpe",
];

// Most metric chips capitalize their key for display; a few need an explicit
// label where simple capitalization reads wrong (e.g. "Rpe" → "RPE").
const METRIC_LABELS: Partial<Record<Metric, string>> = {
  rpe: "RPE",
};

function deriveMetrics(exercise: Exercise): Set<Metric> {
  const m = new Set<Metric>();
  if (!exercise.isBodyweight) m.add("weight");
  if (exercise.trackReps) m.add("reps");
  if (exercise.trackTime) m.add("time");
  if (exercise.trackSpeed) m.add("speed");
  if (exercise.trackIncline) m.add("incline");
  if (exercise.trackResistance) m.add("resistance");
  if (exercise.distanceUnit) m.add("distance");
  if (exercise.trackRest) m.add("rest");
  if (exercise.trackCalories) m.add("calories");
  if (exercise.trackRpe) m.add("rpe");
  return m;
}

interface Props {
  exercise?: Exercise;
  onClose: () => void;
  onCreated?: (exercise: Exercise) => void;
  onUpdated?: (exercise: Exercise) => void;
}

export function ExerciseForm({ exercise, onClose, onCreated, onUpdated }: Props) {
  const {
    categories,
    equipment: equipmentOptions,
    muscleGroups,
    variations,
  } = useUserFieldOptions();
  const location = useLocation();
  // The form is rendered inline (no dedicated URL), so to come back to it
  // after a Customise-fields trip we encode the editing target in `?open=`.
  // The parent route picks this up on return and re-opens the form. New-form
  // returns are best-effort: in-progress field values aren't preserved
  // (would need URL-state or sessionStorage to fix; not done here).
  const openValue = exercise?.id ?? "new";
  const customiseFieldsHref = `/settings/fields?from=${encodeURIComponent(
    `${location.pathname}?open=${openValue}`
  )}`;
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const [name, setName] = useState(exercise?.name ?? "");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(exercise?.categories ?? [])
  );
  const [equipment, setEquipment] = useState<string | null>(exercise?.equipment ?? null);
  const [selectedVariations, setSelectedVariations] = useState<Set<string>>(
    new Set(exercise?.variations ?? [])
  );
  const [muscleMap, setMuscleMap] = useState<Map<string, "primary" | "secondary">>(() => {
    const map = new Map<string, "primary" | "secondary">();
    for (const m of exercise?.muscles ?? []) map.set(m, "primary");
    for (const m of exercise?.secondaryMuscles ?? []) map.set(m, "secondary");
    return map;
  });
  const [metrics, setMetrics] = useState<Set<Metric>>(
    exercise ? deriveMetrics(exercise) : new Set(["reps", "weight"])
  );
  const [hasDefaultWeight, setHasDefaultWeight] = useState((exercise?.defaultWeightKg ?? 0) > 0);
  const [defaultWeightKg, setDefaultWeightKg] = useState(exercise?.defaultWeightKg ?? 0);
  const [doubleReps, setDoubleReps] = useState(exercise?.doubleReps ?? false);
  const [includeBodyweight, setIncludeBodyweight] = useState(
    exercise?.includeBodyweight ?? false
  );
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    (exercise?.distanceUnit as DistanceUnit | null) ?? "km"
  );
  const [inclineUnit, setInclineUnit] = useState<InclineUnit>(
    (exercise?.inclineUnit as InclineUnit | null) ?? "pct"
  );
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(
    (exercise?.speedUnit as SpeedUnit | null) ?? "kmh"
  );
  const [error, setError] = useState<string | null>(null);

  function toggleMetric(m: Metric) {
    setMetrics((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      try {
        const input = {
          name: trimmed,
          categories: selectedCategories.size > 0 ? Array.from(selectedCategories) : null,
          equipment,
          trackReps: metrics.has("reps"),
          isBodyweight: !metrics.has("weight"),
          includeBodyweight,
          defaultWeightKg:
            hasDefaultWeight && metrics.has("weight") ? Number(defaultWeightKg) || 0 : 0,
          doubleReps,
          distanceUnit: metrics.has("distance") ? distanceUnit : null,
          trackTime: metrics.has("time"),
          // Time no longer has a per-exercise unit; durations are entered and
          // shown as h/m/s derived from the stored seconds. Kept nullable in
          // the schema/column so existing rows stay valid.
          timeUnit: null,
          trackResistance: metrics.has("resistance"),
          trackSpeed: metrics.has("speed"),
          speedUnit: metrics.has("speed") ? speedUnit : null,
          trackIncline: metrics.has("incline"),
          inclineUnit: metrics.has("incline") ? inclineUnit : null,
          trackRest: metrics.has("rest"),
          trackCalories: metrics.has("calories"),
          trackRpe: metrics.has("rpe"),
          muscles: (() => {
            const p = [...muscleMap.entries()]
              .filter(([, v]) => v === "primary")
              .map(([k]) => k);
            return p.length > 0 ? p : null;
          })(),
          secondaryMuscles: (() => {
            const s = [...muscleMap.entries()]
              .filter(([, v]) => v === "secondary")
              .map(([k]) => k);
            return s.length > 0 ? s : null;
          })(),
          variations: selectedVariations.size > 0 ? Array.from(selectedVariations) : null,
        };
        if (exercise) {
          await updateExercise(exercise.id, input);
          if (onUpdated) {
            const updated = await getExerciseById(exercise.id);
            if (updated) onUpdated(updated);
          }
          onClose();
        } else {
          const newId = await createExercise(input);
          if (onCreated) {
            const created = await getExerciseById(newId);
            if (created) onCreated(created);
            else onClose();
          } else {
            onClose();
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <header className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">
          {exercise ? "Edit exercise" : "New exercise"}
        </h1>
      </header>
      <Card>
        <CardContent className="py-8 flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ex-name">Name</Label>
            <Input
              id="ex-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bench press"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Category</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={selectedCategories.has(c.key) ? "default" : "secondary"}
                  onClick={() =>
                    setSelectedCategories((prev) => {
                      const next = new Set(prev);
                      next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                      return next;
                    })
                  }
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Equipment</Label>
            <div className="flex flex-wrap gap-2">
              {equipmentOptions.map((eq) => (
                <Button
                  key={eq.id}
                  type="button"
                  size="sm"
                  variant={equipment === eq.key ? "default" : "secondary"}
                  onClick={() => setEquipment(equipment === eq.key ? null : eq.key)}
                >
                  {eq.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Exercise variations</Label>
            {variations.length === 0 ? (
              <p className="text-xs text-muted-foreground -mt-1">
                No variations in your library. Add them using 'Customise fields'.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {variations.map((v) => (
                  <Button
                    key={v.id}
                    type="button"
                    size="sm"
                    variant={selectedVariations.has(v.key) ? "default" : "secondary"}
                    onClick={() =>
                      setSelectedVariations((prev) => {
                        const next = new Set(prev);
                        next.has(v.key) ? next.delete(v.key) : next.add(v.key);
                        return next;
                      })
                    }
                  >
                    {v.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Muscles</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Tap once for primary, twice for secondary
            </p>
            <div className="flex flex-wrap gap-2">
              {muscleGroups.map((g) => {
                const childState = g.children.some((c) => muscleMap.get(c.key) === "primary")
                  ? "primary"
                  : g.children.some((c) => muscleMap.get(c.key) === "secondary")
                    ? "secondary"
                    : null;
                const state =
                  muscleMap.get(g.key) === "primary"
                    ? "primary"
                    : childState === "primary"
                      ? "primary"
                      : muscleMap.get(g.key) === "secondary"
                        ? "secondary"
                        : childState === "secondary"
                          ? "secondary"
                          : null;
                return (
                  <Button
                    key={g.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMuscleMap((prev) => {
                        const next = new Map(prev);
                        const cur = next.get(g.key);
                        if (!cur) {
                          next.set(g.key, "primary");
                        } else if (cur === "primary") {
                          next.set(g.key, "secondary");
                          for (const c of g.children) {
                            if (next.has(c.key)) next.set(c.key, "secondary");
                          }
                        } else {
                          next.delete(g.key);
                          for (const c of g.children) next.delete(c.key);
                        }
                        return next;
                      })
                    }
                    className={
                      state === "primary"
                        ? "bg-blue-800 border-blue-800 text-white hover:bg-blue-900 hover:text-white"
                        : state === "secondary"
                          ? "bg-teal-700 border-teal-700 text-white hover:bg-teal-800 hover:text-white"
                          : "bg-muted text-foreground hover:bg-muted/80"
                    }
                  >
                    {g.label}
                  </Button>
                );
              })}
            </div>
            {(() => {
              const activeGroupKeys = new Set(
                muscleGroups
                  .filter(
                    (g) => muscleMap.has(g.key) || g.children.some((c) => muscleMap.has(c.key))
                  )
                  .map((g) => g.key)
              );
              const seen = new Set<string>();
              const visibleChildren = muscleGroups
                .filter((g) => activeGroupKeys.has(g.key))
                .flatMap((g) => g.children)
                .filter((c) => {
                  if (seen.has(c.key)) return false;
                  seen.add(c.key);
                  return true;
                });
              if (visibleChildren.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-2">
                  {visibleChildren.map((c) => {
                    const state = muscleMap.get(c.key) ?? null;
                    return (
                      <Button
                        key={c.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setMuscleMap((prev) => {
                            const next = new Map(prev);
                            const cur = next.get(c.key);
                            if (!cur) next.set(c.key, "primary");
                            else if (cur === "primary") next.set(c.key, "secondary");
                            else next.delete(c.key);
                            return next;
                          })
                        }
                        className={
                          state === "primary"
                            ? "bg-blue-800 border-blue-800 text-white hover:bg-blue-900 hover:text-white"
                            : state === "secondary"
                              ? "bg-teal-700 border-teal-700 text-white hover:bg-teal-800 hover:text-white"
                              : "bg-muted text-foreground hover:bg-muted/80"
                        }
                      >
                        {c.label}
                      </Button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Metrics</Label>
            <div className="flex flex-wrap gap-2">
              {METRICS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={metrics.has(m) ? "default" : "secondary"}
                  onClick={() => toggleMetric(m)}
                  className="capitalize"
                >
                  {METRIC_LABELS[m] ?? m}
                </Button>
              ))}
            </div>
          </div>

          {metrics.has("incline") && (
            <div className="flex flex-col gap-2">
              <Label>Incline unit</Label>
              <div className="flex flex-wrap gap-2">
                {INCLINE_UNITS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={inclineUnit === value ? "default" : "outline"}
                    onClick={() => setInclineUnit(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {metrics.has("speed") && (
            <div className="flex flex-col gap-2">
              <Label>Speed unit</Label>
              <div className="flex flex-wrap gap-2">
                {SPEED_UNITS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={speedUnit === value ? "default" : "outline"}
                    onClick={() => setSpeedUnit(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {metrics.has("distance") && (
            <div className="flex flex-col gap-2">
              <Label>Distance unit</Label>
              <div className="flex flex-wrap gap-2">
                {DISTANCE_UNITS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={distanceUnit === value ? "default" : "outline"}
                    onClick={() => setDistanceUnit(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {metrics.has("weight") && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <Label htmlFor="ex-default-toggle">Set default weight</Label>
                  <span className="text-xs text-muted-foreground">
                    Added to every set automatically (e.g. 20kg barbell).
                  </span>
                </div>
                <Switch
                  id="ex-default-toggle"
                  checked={hasDefaultWeight}
                  onCheckedChange={setHasDefaultWeight}
                />
              </div>
              {hasDefaultWeight && (
                <Input
                  id="ex-default"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={defaultWeightKg || ""}
                  onChange={(e) => setDefaultWeightKg(Number(e.target.value) || 0)}
                  placeholder="kg"
                />
              )}
            </div>
          )}

          {metrics.has("reps") && (
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label htmlFor="ex-double">Double reps</Label>
                <span className="text-xs text-muted-foreground">
                  If reps count per side (e.g. dumbbell curls).
                </span>
              </div>
              <Switch id="ex-double" checked={doubleReps} onCheckedChange={setDoubleReps} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label htmlFor="ex-include-bw">Include bodyweight</Label>
              <span className="text-xs text-muted-foreground">
                If bodyweight is included in stats calculations. Enter bodyweight in Settings.
              </span>
            </div>
            <Switch
              id="ex-include-bw"
              checked={includeBodyweight}
              onCheckedChange={setIncludeBodyweight}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex gap-2 pt-4">
        <Button variant="outline" onClick={onClose} className="flex-1" disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={save} className="flex-1" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <Link
        to={customiseFieldsHref}
        className="flex items-center gap-3 p-4 mt-4 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
      >
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Customise fields</div>
          <div className="text-sm text-muted-foreground">
            Edit categories, equipment, and muscle groups
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
