import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, MoreHorizontal, Plus, X } from "lucide-react";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import { NoteTray } from "@/components/note-field";
import { PBBadges } from "@/components/pb-badge";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import type { DraftSet, ExerciseGroup } from "./workout-editor-types";
import { getExerciseHistory, getLastSessionSetsForExercise } from "@/lib/db/queries";
import { updateExerciseNotes } from "@/lib/mutations/exercises";
import { computePBsInOrder, type PBType } from "@/lib/stats/set-pbs";
import { VariationControl } from "./variation-control";

interface Props {
  group: ExerciseGroup;
  workoutId: string;
  onUpdate: (next: ExerciseGroup) => void;
  onRemove: () => void;
  onEdit: () => void;
  // "template" mode edits a template skeleton: no auto-prefill from history, no
  // PB badges, no history list, and "See stats" returns to the template editor.
  mode?: "workout" | "template";
}

type TrayState = {
  setIndex: number;
  draft: DraftSet;
  suggestion?: DraftSet | null;
};

export function SetRows({ group, workoutId, onUpdate, onRemove, onEdit, mode = "workout" }: Props) {
  const isTemplate = mode === "template";
  const navigate = useNavigate();
  const [tray, setTray] = useState<TrayState | null>(null);
  const lastLoggedRef = useRef<Array<{
    reps: number | null;
    weightKg: number | null;
    distanceKm: number | null;
    durationSec: number | null;
    resistance: number | null;
    speedMs: number | null;
    inclinePct: number | null;
    restSec: number | null;
    rpe: number | null;
  }> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteTrayOpen, setNoteTrayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Note lives on the Exercise itself (per-exercise, owner-only). Local state
  // mirrors `group.exercise.notes` so the tray edits show instantly; the
  // async write to Postgres re-syncs through PowerSync and refreshes the prop.
  const [exerciseNote, setExerciseNote] = useState<string | null>(group.exercise.notes ?? null);
  useEffect(() => {
    setExerciseNote(group.exercise.notes ?? null);
  }, [group.exercise.notes]);
  const [priorSetsAsc, setPriorSetsAsc] = useState<WorkoutSet[] | null>(null);

  async function saveExerciseNote(value: string | null) {
    const trimmed = value && value.trim().length > 0 ? value : null;
    setExerciseNote(trimmed);
    try {
      await updateExerciseNotes(group.exerciseId, trimmed);
    } catch (err) {
      console.error("[set-rows] failed to save exercise note:", err);
    }
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.groupKey,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // Keep refs of the latest `group` and `onUpdate` so the async effect below
  // doesn't write back stale state. Without this, an edit made by the parent
  // while getLastSessionSetsForExercise is in flight gets overwritten when the
  // closure-captured `group` resolves.
  const groupRef = useRef(group);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    groupRef.current = group;
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    getLastSessionSetsForExercise(group.exerciseId, workoutId)
      .then((last) => {
        if (cancelled || last.length === 0) return;
        const lastSets = last.map((s) => ({
          reps: s.reps,
          weightKg: s.weightKg,
          distanceKm: s.distanceKm,
          durationSec: s.durationSec,
          resistance: s.resistance,
          speedMs: s.speedMs,
          inclinePct: s.inclinePct,
          restSec: s.restSec,
          rpe: s.rpe,
        }));
        lastLoggedRef.current = lastSets;
        const currentGroup = groupRef.current;
        const nextSets = currentGroup.sets.map((s, i) => {
          if (
            s.reps != null ||
            s.weightKg != null ||
            s.distanceKm != null ||
            s.durationSec != null ||
            s.resistance != null ||
            s.speedMs != null ||
            s.inclinePct != null ||
            s.restSec != null ||
            s.rpe != null
          )
            return s;
          const src = lastSets[i] ?? lastSets[0];
          return {
            ...s,
            reps: src.reps,
            weightKg: src.weightKg,
            distanceKm: src.distanceKm,
            durationSec: src.durationSec,
            resistance: src.resistance,
            speedMs: src.speedMs,
            inclinePct: src.inclinePct,
            restSec: src.restSec,
            rpe: src.rpe,
          };
        });
        // Exercise notes are now persisted on the Exercise itself (not the
        // session), so no per-session carry-forward is needed.
        const setsChanged = nextSets.some((s, i) => s !== currentGroup.sets[i]);
        if (setsChanged) {
          onUpdateRef.current({ ...currentGroup, sets: nextSets });
        }
      })
      .catch((err) => {
        console.error("[set-rows] failed to load last sets:", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.exerciseId, workoutId]);

  // Pull prior sets for this exercise (excluding the current workout) so we
  // can detect PBs hit by sets being logged right now.
  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    getExerciseHistory(group.exerciseId, workoutId)
      .then((entries) => {
        if (cancelled) return;
        // Entries are newest-first; flatten chronologically (oldest → newest).
        const flat: WorkoutSet[] = [];
        for (let i = entries.length - 1; i >= 0; i--) {
          for (const s of entries[i].sets) flat.push(s);
        }
        setPriorSetsAsc(flat);
      })
      .catch((err) => {
        console.error("[set-rows] failed to load PB history:", err);
        setPriorSetsAsc([]);
      });
    return () => {
      cancelled = true;
    };
  }, [group.exerciseId, workoutId]);

  const pbsByCurrentSetIndex = useMemo<PBType[][]>(() => {
    if (priorSetsAsc === null) return group.sets.map(() => []);
    const combined = [...priorSetsAsc, ...group.sets];
    const all = computePBsInOrder(combined, group.exercise);
    return all.slice(priorSetsAsc.length);
  }, [priorSetsAsc, group.sets, group.exercise]);

  function openAddTray() {
    const last = group.sets[group.sets.length - 1];
    const historySuggestion = lastLoggedRef.current?.[0]
      ? { exerciseId: group.exerciseId, ...lastLoggedRef.current[0] }
      : null;
    setTray({
      setIndex: -1,
      draft: {
        exerciseId: group.exerciseId,
        reps: null,
        weightKg: null,
        distanceKm: null,
        durationSec: null,
        resistance: null,
        speedMs: null,
        inclinePct: null,
        restSec: null,
        calories: null,
        rpe: null,
      },
      suggestion: last ?? historySuggestion,
    });
  }

  function openEditTray(idx: number) {
    setTray({ setIndex: idx, draft: { ...group.sets[idx] } });
  }

  function confirmTray(draft: DraftSet) {
    if (!tray) return;
    if (tray.setIndex === -1) {
      onUpdate({ ...group, sets: [...group.sets, draft] });
    } else {
      const next = group.sets.map((s, i) => (i === tray.setIndex ? { ...s, ...draft } : s));
      onUpdate({ ...group, sets: next });
    }
    setTray(null);
  }

  function removeSet(idx: number) {
    const next = group.sets.filter((_, i) => i !== idx);
    onUpdate({ ...group, sets: next });
  }

  const ex = group.exercise;
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";

  return (
    <>
      <div ref={setNodeRef} style={dragStyle} {...attributes} {...listeners}>
        <Card>
          <div className="flex items-start gap-3 p-3">
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <span className="font-medium break-words min-w-0 flex-1">{ex.name}</span>
                {!isTemplate && (
                  <VariationControl
                    group={group}
                    onChange={(variation) => onUpdate({ ...group, variation })}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
                <ExerciseMetaTags e={ex} />
              </span>
            </div>
            <span className="inline-flex h-6 shrink-0 items-center">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setMenuOpen(true)}
                aria-label="Exercise options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </span>
          </div>

          <div className="px-3 pb-3 flex flex-col gap-0.5">
            {group.sets.map((s, i) => (
              <SetSummaryRow
                key={s.id ?? `new-${i}`}
                index={i + 1}
                set={s}
                exercise={ex}
                distanceUnit={distanceUnit}
                pbs={pbsByCurrentSetIndex[i] ?? []}
                onClick={() => openEditTray(i)}
                onRemove={() => removeSet(i)}
              />
            ))}
            <div className="flex items-center mt-1">
              <Button variant="ghost" size="sm" onClick={openAddTray} className="flex-1">
                <Plus className="h-4 w-4" /> Add set
              </Button>
              {!isTemplate && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setHistoryOpen((o) => !o)}
                  aria-label={historyOpen ? "Hide history" : "Show history"}
                  className="text-muted-foreground"
                >
                  {historyOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {!isTemplate && historyOpen && (
            <div className="border-t border-border flex flex-col">
              {exerciseNote && exerciseNote.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setNoteTrayOpen(true)}
                  className="mx-3 mt-3 mb-1 rounded-xl bg-muted/50 px-3 py-2 text-left text-sm whitespace-pre-wrap hover:bg-muted"
                  aria-label="Edit note"
                >
                  {exerciseNote}
                </button>
              )}
              <ExerciseHistoryList
                exerciseId={group.exerciseId}
                exercise={ex}
                excludeWorkoutId={workoutId}
                futureSets={group.sets}
              />
            </div>
          )}
        </Card>
      </div>

      {tray && (
        <SetTray
          exercise={ex}
          draft={tray.draft}
          suggestion={tray.suggestion}
          isNew={tray.setIndex === -1}
          onConfirm={confirmTray}
          onClose={() => setTray(null)}
        />
      )}

      {noteTrayOpen && (
        <NoteTray
          initialValue={exerciseNote}
          placeholder="Add a note for this exercise…"
          showVisibilityToggle={false}
          showDelete
          onConfirm={(notes) => {
            void saveExerciseNote(notes);
            setNoteTrayOpen(false);
          }}
          onDelete={() => {
            void saveExerciseNote(null);
            setNoteTrayOpen(false);
          }}
          onClose={() => setNoteTrayOpen(false)}
        />
      )}

      {menuOpen && (
        <ExerciseMenu
          hasNote={!!(exerciseNote && exerciseNote.trim().length > 0)}
          onNote={() => {
            setMenuOpen(false);
            setNoteTrayOpen(true);
            setHistoryOpen(true);
          }}
          onViewStats={() => {
            setMenuOpen(false);
            navigate(
              `/exercises/${group.exerciseId}?from=${isTemplate ? "/templates" : "/log"}/${workoutId}`
            );
          }}
          onEdit={() => {
            setMenuOpen(false);
            onEdit();
          }}
          onRemove={() => {
            setMenuOpen(false);
            onRemove();
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function formatSetSummary(
  s: DraftSet,
  ex: Exercise,
  distanceUnit: "m" | "km" | "yd"
): string {
  const parts: string[] = [];
  if (!ex.isBodyweight && s.weightKg != null) {
    const dw = ex.defaultWeightKg ?? 0;
    parts.push(dw > 0 ? `${s.weightKg}+${dw} kg` : `${s.weightKg} kg`);
  }
  if (ex.trackReps && s.reps != null)
    parts.push(`${s.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && s.durationSec != null)
    parts.push(formatDuration(s.durationSec, (ex.timeUnit ?? "min") as "h" | "min" | "sec"));
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
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  if (ex.trackRpe && s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatDuration(sec: number, unit: "h" | "min" | "sec"): string {
  if (unit === "sec") return `${sec} secs`;
  if (unit === "min") {
    const mins = Math.round((sec / 60) * 10) / 10;
    return `${mins} mins`;
  }
  const hrs = Math.round((sec / 3600) * 100) / 100;
  return `${hrs} hrs`;
}

function SetSummaryRow({
  index,
  set,
  exercise,
  distanceUnit,
  pbs,
  onClick,
  onRemove,
}: {
  index: number;
  set: DraftSet;
  exercise: Exercise;
  distanceUnit: "m" | "km" | "yd";
  pbs: PBType[];
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50">
      <span className="text-sm text-muted-foreground w-6 shrink-0 text-center">{index}</span>
      <button
        type="button"
        onClick={onClick}
        className="flex-1 text-left text-sm py-0.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1"
      >
        <span>{formatSetSummary(set, exercise, distanceUnit)}</span>
        <PBBadges types={pbs} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove set ${index}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ExerciseMenu({
  hasNote,
  onNote,
  onViewStats,
  onEdit,
  onRemove,
  onClose,
}: {
  hasNote: boolean;
  onNote: () => void;
  onViewStats: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col py-4 gap-2 px-4">
          <button
            type="button"
            onClick={onNote}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            {hasNote ? "Edit note" : "Add note"}
          </button>
          <button
            type="button"
            onClick={onViewStats}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            See stats
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Edit exercise
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete entry
          </button>
        </div>
      </div>
    </>
  );
}

export function SetTray({
  exercise,
  draft: initialDraft,
  suggestion,
  isNew,
  onConfirm,
  onClose,
}: {
  exercise: Exercise;
  draft: DraftSet;
  suggestion?: DraftSet | null;
  isNew: boolean;
  onConfirm: (draft: DraftSet) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DraftSet>(initialDraft);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function patch(p: Partial<DraftSet>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  function handleConfirm() {
    if (isNew && suggestion) {
      onConfirm({
        ...draft,
        reps: draft.reps ?? suggestion.reps,
        weightKg: draft.weightKg ?? suggestion.weightKg,
        distanceKm: draft.distanceKm ?? suggestion.distanceKm,
        durationSec: draft.durationSec ?? suggestion.durationSec,
        resistance: draft.resistance ?? suggestion.resistance,
        speedMs: draft.speedMs ?? suggestion.speedMs,
        inclinePct: draft.inclinePct ?? suggestion.inclinePct,
        restSec: draft.restSec ?? suggestion.restSec,
        calories: draft.calories ?? suggestion.calories,
        rpe: draft.rpe ?? suggestion.rpe,
      });
    } else {
      onConfirm(draft);
    }
  }

  const ex = exercise;
  const showWeight = !ex.isBodyweight;
  const showReps = ex.trackReps;
  const showTime = ex.trackTime;
  const showSpeed = ex.trackSpeed;
  const showIncline = ex.trackIncline;
  const showResistance = ex.trackResistance;
  const showDistance = !!ex.distanceUnit;
  const showRest = ex.trackRest;
  const showCalories = ex.trackCalories;
  const showRpe = ex.trackRpe;
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";
  const timeUnit = (ex.timeUnit ?? "min") as "h" | "min" | "sec";
  const isKmh = (ex.speedUnit ?? "kmh") === "kmh";

  const sg = isNew ? suggestion : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out max-h-[85vh] overflow-y-auto ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="font-semibold">{isNew ? "Add set" : "Edit set"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-4 grid grid-cols-2 gap-x-4 gap-y-4">
          {showWeight && (
            <TrayField
              label={(ex.defaultWeightKg ?? 0) > 0 ? `Weight (+${ex.defaultWeightKg} kg)` : "Weight"}
              unit="kg"
            >
              <NumInput
                value={draft.weightKg}
                onChange={(v) => patch({ weightKg: v })}
                step={0.5}
                placeholder={sg?.weightKg != null ? String(sg.weightKg) : "60"}
                className="w-full"
              />
            </TrayField>
          )}
          {showReps && (
            <TrayField label="Reps" unit="reps">
              <NumInput
                value={draft.reps}
                onChange={(v) => patch({ reps: v == null ? null : Math.round(v) })}
                step={1}
                placeholder={sg?.reps != null ? String(sg.reps) : "10"}
                className="w-full"
              />
            </TrayField>
          )}
          {showTime && (
            <TrayField label="Duration" unit={timeUnit}>
              <NumInput
                value={toDisplayTime(draft.durationSec, timeUnit)}
                onChange={(v) => patch({ durationSec: toSec(v, timeUnit) })}
                step={timeUnit === "h" ? 0.25 : timeUnit === "sec" ? 5 : 0.5}
                placeholder={
                  sg?.durationSec != null
                    ? String(toDisplayTime(sg.durationSec, timeUnit) ?? "")
                    : timeUnit === "h"
                      ? "1.0"
                      : timeUnit === "sec"
                        ? "60"
                        : "30"
                }
                className="w-full"
              />
            </TrayField>
          )}
          {showSpeed && (
            <TrayField label="Speed" unit={isKmh ? "km/h" : "m/s"}>
              <NumInput
                value={
                  draft.speedMs != null
                    ? isKmh
                      ? +(draft.speedMs * 3.6).toFixed(1)
                      : draft.speedMs
                    : null
                }
                onChange={(v) => patch({ speedMs: v != null ? (isKmh ? v / 3.6 : v) : null })}
                step={isKmh ? 0.5 : 0.1}
                placeholder={
                  sg?.speedMs != null
                    ? String(isKmh ? +(sg.speedMs * 3.6).toFixed(1) : sg.speedMs)
                    : isKmh
                      ? "10"
                      : "3.0"
                }
                className="w-full"
              />
            </TrayField>
          )}
          {showIncline && (
            <TrayField label="Incline" unit={ex.inclineUnit === "setting" ? "" : "%"}>
              <NumInput
                value={draft.inclinePct}
                onChange={(v) => patch({ inclinePct: v })}
                step={ex.inclineUnit === "setting" ? 1 : 0.5}
                placeholder={sg?.inclinePct != null ? String(sg.inclinePct) : "5"}
                className="w-full"
              />
            </TrayField>
          )}
          {showResistance && (
            <TrayField label="Resistance" unit="res">
              <NumInput
                value={draft.resistance}
                onChange={(v) => patch({ resistance: v != null ? Math.round(v) : null })}
                step={1}
                placeholder={sg?.resistance != null ? String(sg.resistance) : "10"}
                className="w-full"
              />
            </TrayField>
          )}
          {showDistance && (
            <TrayField label="Distance" unit={distanceUnit}>
              <NumInput
                value={toDisplayDist(draft.distanceKm, distanceUnit)}
                onChange={(v) => patch({ distanceKm: toKm(v, distanceUnit) })}
                step={distanceUnit === "km" ? 0.1 : 1}
                placeholder={
                  sg?.distanceKm != null
                    ? String(toDisplayDist(sg.distanceKm, distanceUnit) ?? "")
                    : distanceUnit === "km"
                      ? "5.0"
                      : distanceUnit === "m"
                        ? "1,000"
                        : "550"
                }
                className="w-full"
                {...(distanceUnit === "m"
                  ? {
                      format: (v: number) => v.toLocaleString("en-US"),
                      parse: (s: string) => {
                        const n = Number(s.replace(/,/g, ""));
                        return Number.isNaN(n) ? null : n;
                      },
                    }
                  : {})}
              />
            </TrayField>
          )}
          {showRest && (
            <TrayField label="Rest" unit="sec">
              <NumInput
                value={draft.restSec}
                onChange={(v) => patch({ restSec: v != null ? Math.round(v) : null })}
                step={5}
                placeholder={sg?.restSec != null ? String(sg.restSec) : "60"}
                className="w-full"
              />
            </TrayField>
          )}
          {showCalories && (
            <TrayField label="Calories" unit="kcal">
              <NumInput
                value={draft.calories}
                onChange={(v) => patch({ calories: v != null ? Math.round(v) : null })}
                step={1}
                placeholder={sg?.calories != null ? String(sg.calories) : "100"}
                className="w-full"
              />
            </TrayField>
          )}
          {showRpe && (
            <TrayField label="RPE" unit="">
              <NumInput
                value={draft.rpe}
                onChange={(v) => patch({ rpe: v != null ? Math.round(v) : null })}
                step={1}
                placeholder={sg?.rpe != null ? String(sg.rpe) : "8"}
                className="w-full"
              />
            </TrayField>
          )}
        </div>

        <div className="px-4 pb-8">
          <Button onClick={handleConfirm} className="w-full" size="lg">
            {isNew ? "Add set" : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
}

function TrayField({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {children}
        <span className="text-sm text-muted-foreground shrink-0">{unit}</span>
      </div>
    </div>
  );
}

function toDisplayTime(sec: number | null, unit: "h" | "min" | "sec"): number | null {
  if (sec == null) return null;
  if (unit === "h") return Math.round((sec / 3600) * 100) / 100;
  if (unit === "sec") return sec;
  return Math.round((sec / 60) * 10) / 10;
}

function toSec(display: number | null, unit: "h" | "min" | "sec"): number | null {
  if (display == null) return null;
  if (unit === "h") return Math.round(display * 3600);
  if (unit === "sec") return Math.round(display);
  return Math.round(display * 60);
}

function toDisplayDist(km: number | null, unit: "m" | "km" | "yd"): number | null {
  if (km == null) return null;
  if (unit === "m") return Math.round(km * 1000);
  if (unit === "yd") return Math.round(km * 1093.61);
  return km;
}

function toKm(display: number | null, unit: "m" | "km" | "yd"): number | null {
  if (display == null) return null;
  if (unit === "m") return display / 1000;
  if (unit === "yd") return display / 1093.61;
  return display;
}

function NumInput({
  value,
  onChange,
  step = 1,
  placeholder,
  className = "w-24",
  format,
  parse,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  placeholder?: string;
  className?: string;
  format?: (v: number) => string;
  parse?: (s: string) => number | null;
}) {
  const [text, setText] = useState(() => (value != null && format ? format(value) : ""));
  const isFormatted = !!format && !!parse;

  useEffect(() => {
    if (isFormatted) setText(value != null ? format!(value) : "");
  }, [value, isFormatted, format]);

  if (isFormatted) {
    return (
      <div className={`relative ${className}`}>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const stripped = text.replace(/,/g, "");
            if (stripped === "") {
              onChange(null);
              setText("");
              return;
            }
            const n = Number(stripped);
            if (!Number.isNaN(n)) {
              onChange(n);
              setText(format!(n));
            } else setText(value != null ? format!(value) : "");
          }}
          className="h-10 w-full rounded-md border border-border bg-background px-2 text-center text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(null);
          else {
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        className="h-10 w-full rounded-md border border-border bg-background px-2 text-center text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
