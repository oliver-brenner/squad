import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import { NoteTray } from "@/components/note-field";
import { PBBadges } from "@/components/pb-badge";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { isBlankSet, type DraftSet, type ExerciseGroup } from "./workout-editor-types";
import { getExerciseHistory, getLastSessionSetsForExercise } from "@/lib/db/queries";
import { updateExerciseNotes } from "@/lib/mutations/exercises";
import { computePBsInOrder, type PBType } from "@/lib/stats/set-pbs";
import { useTimer } from "@/components/providers/timer-provider";
import {
  formatDuration,
  secToTimeParts,
  timePartsToSec,
  mToHeight,
  heightToM,
  type TimeParts,
  type HeightUnit,
} from "@/lib/set-format";
import { VariationControl } from "./variation-control";

interface Props {
  group: ExerciseGroup;
  workoutId: string;
  onUpdate: (next: ExerciseGroup) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  // "template" mode edits a template skeleton: no auto-prefill from history, no
  // PB badges, no history list, and "See stats" returns to the template editor.
  mode?: "workout" | "template";
  // Show the greyed "ghost" set. Only the active entry of the most recent
  // session gets one, so earlier exercises stay clean.
  showGhost?: boolean;
}

type TrayState = {
  setIndex: number;
  draft: DraftSet;
  suggestion?: DraftSet | null;
};

export function SetRows({
  group,
  workoutId,
  onUpdate,
  onRemove,
  onDuplicate,
  onEdit,
  mode = "workout",
  showGhost = false,
}: Props) {
  const isTemplate = mode === "template";
  const navigate = useNavigate();
  const timer = useTimer();
  const [tray, setTray] = useState<TrayState | null>(null);
  // Sets from the most recent session that logged this exercise, in performed
  // order. Drives the greyed "ghost" suggestion for the first (not-yet-logged)
  // set. State (not a ref) so the ghost appears once the async load resolves.
  const [lastLogged, setLastLogged] = useState<DraftSet[] | null>(null);
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

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.groupKey,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // Load the previous session's sets for this exercise. These are no longer
  // written into the draft automatically — instead they seed the greyed ghost
  // suggestion (see `ghostSuggestion`) that the user taps to harden.
  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    getLastSessionSetsForExercise(group.exerciseId, workoutId)
      .then((last) => {
        if (cancelled) return;
        setLastLogged(
          last.map((s) => ({
            exerciseId: group.exerciseId,
            reps: s.reps,
            weightKg: s.weightKg,
            distanceKm: s.distanceKm,
            durationSec: s.durationSec,
            resistance: s.resistance,
            speedMs: s.speedMs,
            inclinePct: s.inclinePct,
            restSec: s.restSec,
            calories: s.calories,
            rpe: s.rpe,
            steps: s.steps,
            heightM: s.heightM,
          }))
        );
      })
      .catch((err) => {
        console.error("[set-rows] failed to load last sets:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [group.exerciseId, workoutId, isTemplate]);

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

  // The logged (hardened) sets. In a live session the not-yet-logged "anchor"
  // set is hidden and replaced by the ghost row; templates keep every set
  // (including intentionally-blank skeleton sets) visible and editable.
  const displaySets = useMemo(
    () => (isTemplate ? group.sets : group.sets.filter((s) => !isBlankSet(s))),
    [group.sets, isTemplate]
  );

  const pbsByCurrentSetIndex = useMemo<PBType[][]>(() => {
    if (priorSetsAsc === null) return displaySets.map(() => []);
    const combined = [...priorSetsAsc, ...displaySets];
    const all = computePBsInOrder(combined, group.exercise);
    return all.slice(priorSetsAsc.length);
  }, [priorSetsAsc, displaySets, group.exercise]);

  // The greyed set shown below the logged sets, waiting to be tapped. It
  // duplicates the last logged set, or — before anything is logged — the first
  // set of the previous session. Null (no ghost) in templates and when there's
  // nothing to suggest.
  const ghostSuggestion = useMemo<DraftSet | null>(() => {
    if (isTemplate) return null;
    const last = displaySets[displaySets.length - 1];
    if (last) {
      const { id: _id, ...rest } = last;
      return rest;
    }
    const hist = lastLogged?.[0];
    return hist ? { ...hist } : null;
  }, [isTemplate, displaySets, lastLogged]);

  function hardenGhost() {
    if (!ghostSuggestion) return;
    const newSet: DraftSet = { ...ghostSuggestion, id: undefined };
    // Drop the blank anchor (if this is the first set) and append the new one.
    onUpdate({ ...group, sets: [...group.sets.filter((s) => !isBlankSet(s)), newSet] });
    if (!isTemplate && group.exercise.trackRest && newSet.restSec != null) {
      timer.startRest(newSet.restSec);
    }
  }

  function openAddTray() {
    const last = displaySets[displaySets.length - 1];
    const historySuggestion = lastLogged?.[0] ?? null;
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
        steps: null,
        heightM: null,
      },
      suggestion: last ?? historySuggestion,
    });
  }

  function openEditTray(set: DraftSet) {
    setTray({ setIndex: group.sets.indexOf(set), draft: { ...set } });
  }

  function confirmTray(draft: DraftSet) {
    if (!tray) return;
    const isNewSet = tray.setIndex === -1;
    if (isNewSet) {
      // Manual entry takes priority over the ghost: drop the blank anchor (if
      // present) so the typed set becomes the first real one. Templates keep
      // every set, so append there.
      const base = isTemplate ? group.sets : group.sets.filter((s) => !isBlankSet(s));
      onUpdate({ ...group, sets: [...base, draft] });
    } else {
      const next = group.sets.map((s, i) => (i === tray.setIndex ? { ...s, ...draft } : s));
      onUpdate({ ...group, sets: next });
    }
    // Logging a new set with a rest value (re)starts the live rest timer.
    if (isNewSet && !isTemplate && group.exercise.trackRest && draft.restSec != null) {
      timer.startRest(draft.restSec);
    }
    setTray(null);
  }

  function removeSet(set: DraftSet) {
    onUpdate({ ...group, sets: group.sets.filter((s) => s !== set) });
  }

  const ex = group.exercise;
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";

  return (
    <>
      <div ref={setNodeRef} style={dragStyle}>
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
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                style={{ touchAction: "none" }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground cursor-grab touch-none"
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </span>
          </div>

          <div className="px-3 pb-3 flex flex-col gap-0.5">
            {displaySets.map((s, i) => (
              <SetSummaryRow
                key={s.id ?? `new-${i}`}
                index={i + 1}
                set={s}
                exercise={ex}
                distanceUnit={distanceUnit}
                pbs={pbsByCurrentSetIndex[i] ?? []}
                onClick={() => openEditTray(s)}
                onRemove={() => removeSet(s)}
              />
            ))}
            {showGhost && ghostSuggestion && (
              <GhostSetRow
                index={displaySets.length + 1}
                set={ghostSuggestion}
                exercise={ex}
                distanceUnit={distanceUnit}
                onClick={hardenGhost}
              />
            )}
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
                futureSets={displaySets}
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
          onDuplicate={() => {
            setMenuOpen(false);
            onDuplicate();
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

// Returns each metric as its own string (e.g. "RPE 7", "40 kg") so the row can
// render them as individual non-wrapping blocks — a metric never splits across
// lines, it wraps as a whole.
function formatSetSummaryParts(
  s: DraftSet,
  ex: Exercise,
  distanceUnit: "m" | "km" | "yd"
): string[] {
  const parts: string[] = [];
  if (!ex.isBodyweight && s.weightKg != null) {
    const dw = ex.defaultWeightKg ?? 0;
    parts.push(dw > 0 ? `${s.weightKg}+${dw} kg` : `${s.weightKg} kg`);
  }
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
  if (ex.trackRpe && s.rpe != null) parts.push(`RPE ${s.rpe}`);
  // Rest is always shown last against the set.
  if (ex.trackRest && s.restSec != null) parts.push(`${s.restSec}s rest`);
  return parts;
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
        className="flex-1 text-left text-sm py-0.5 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        {(() => {
          const parts = formatSetSummaryParts(set, exercise, distanceUnit);
          if (parts.length === 0) return <span>—</span>;
          // Each metric is its own non-wrapping block, so "RPE 7" wraps as a
          // whole. The divider is a separate item between metrics: on wrap it
          // stays trailing on the previous line rather than leading the new one.
          return parts.map((p, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span className="text-muted-foreground/50" aria-hidden>
                  ·
                </span>
              )}
              <span className="whitespace-nowrap">{p}</span>
            </Fragment>
          ));
        })()}
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

// The greyed, tap-to-log preview of the next set. Renders the suggested values
// dimmed; tapping hardens it into a real set (see hardenGhost).
function GhostSetRow({
  index,
  set,
  exercise,
  distanceUnit,
  onClick,
}: {
  index: number;
  set: DraftSet;
  exercise: Exercise;
  distanceUnit: "m" | "km" | "yd";
  onClick: () => void;
}) {
  const parts = formatSetSummaryParts(set, exercise, distanceUnit);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left opacity-45 hover:opacity-70 transition-opacity"
      aria-label={`Add set ${index} (repeat previous)`}
    >
      <span className="text-sm text-muted-foreground w-6 shrink-0 text-center">{index}</span>
      <span className="flex-1 text-sm py-0.5 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {parts.length === 0 ? (
          <span>—</span>
        ) : (
          parts.map((p, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span className="text-muted-foreground/50" aria-hidden>
                  ·
                </span>
              )}
              <span className="whitespace-nowrap">{p}</span>
            </Fragment>
          ))
        )}
      </span>
      <span className="flex h-7 w-7 items-center justify-center text-muted-foreground" aria-hidden>
        <Plus className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function ExerciseMenu({
  hasNote,
  onNote,
  onViewStats,
  onEdit,
  onDuplicate,
  onRemove,
  onClose,
}: {
  hasNote: boolean;
  onNote: () => void;
  onViewStats: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
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
            onClick={onDuplicate}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Duplicate exercise
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
  // Time is edited as separate h/m/s inputs but still stored as total seconds
  // on the draft, so we hold the editable breakdown locally and recombine on
  // every change.
  const [timeParts, setTimeParts] = useState<TimeParts>(() =>
    secToTimeParts(initialDraft.durationSec)
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function patch(p: Partial<DraftSet>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  function patchTime(p: Partial<TimeParts>) {
    const next = { ...timeParts, ...p };
    setTimeParts(next);
    patch({ durationSec: timePartsToSec(next) });
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
        steps: draft.steps ?? suggestion.steps,
        heightM: draft.heightM ?? suggestion.heightM,
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
  const showSteps = ex.trackSteps;
  const showHeight = !!ex.heightUnit;
  const distanceUnit = (ex.distanceUnit ?? "km") as "m" | "km" | "yd";
  const heightUnit = (ex.heightUnit ?? "cm") as HeightUnit;
  const isKmh = (ex.speedUnit ?? "kmh") === "kmh";

  const sg = isNew ? suggestion : null;
  const sgTime = secToTimeParts(sg?.durationSec ?? null);

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
            <div className="col-span-2 grid grid-cols-3 gap-4">
              <TrayField label="Hours" unit="h">
                <NumInput
                  value={timeParts.h}
                  onChange={(v) => patchTime({ h: v == null ? null : Math.max(0, Math.round(v)) })}
                  step={1}
                  placeholder={sgTime.h != null ? String(sgTime.h) : "0"}
                  className="w-full"
                />
              </TrayField>
              <TrayField label="Minutes" unit="m">
                <NumInput
                  value={timeParts.m}
                  onChange={(v) => patchTime({ m: v == null ? null : Math.max(0, Math.round(v)) })}
                  step={1}
                  placeholder={sgTime.m != null ? String(sgTime.m) : "0"}
                  className="w-full"
                />
              </TrayField>
              <TrayField label="Seconds" unit="s">
                <NumInput
                  value={timeParts.s}
                  onChange={(v) => patchTime({ s: v == null ? null : Math.max(0, Math.round(v)) })}
                  step={5}
                  placeholder={sgTime.s != null ? String(sgTime.s) : "0"}
                  className="w-full"
                />
              </TrayField>
            </div>
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
          {showHeight && (
            <TrayField label="Height" unit={heightUnit}>
              <NumInput
                value={draft.heightM != null ? mToHeight(draft.heightM, heightUnit) : null}
                onChange={(v) => patch({ heightM: v != null ? heightToM(v, heightUnit) : null })}
                step={heightUnit === "cm" || heightUnit === "in" ? 1 : 0.1}
                placeholder={
                  sg?.heightM != null
                    ? String(mToHeight(sg.heightM, heightUnit))
                    : heightUnit === "cm"
                      ? "50"
                      : heightUnit === "in"
                        ? "20"
                        : "1"
                }
                className="w-full"
              />
            </TrayField>
          )}
          {showSteps && (
            <TrayField label="Steps" unit="steps">
              <NumInput
                value={draft.steps}
                onChange={(v) => patch({ steps: v != null ? Math.round(v) : null })}
                step={1}
                placeholder={sg?.steps != null ? String(sg.steps) : "1000"}
                className="w-full"
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
