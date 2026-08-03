import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Merge, Minus, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExerciseMetaTags } from "@/components/exercise-meta";
import { ExerciseHistoryList } from "@/components/exercise-history-list";
import { PBBadges } from "@/components/pb-badge";
import type { Exercise, WorkoutSet } from "@/lib/db/types";
import { circuitBodyId, isBlankSet, type DraftSet, type ExerciseGroup, type CircuitGroup } from "./workout-editor-types";
import {
  canSplitRound,
  expandAllRounds,
  normalizeSegments,
  roundValues,
  segmentRanges,
  segmentRounds,
  setAllRoundValues,
  setRoundValues,
} from "./circuit-segments";
import { SetTray } from "./set-rows";
import { useTimer } from "@/components/providers/timer-provider";
import { getExerciseHistory, getLastSessionSetsForExercise } from "@/lib/db/queries";
import { computePBsInOrder, type PBType } from "@/lib/stats/set-pbs";
import { formatDuration, formatWeightPart, mToHeight, type HeightUnit } from "@/lib/set-format";
import { VariationControl, VariationTag } from "./variation-control";

interface Props {
  circuit: CircuitGroup;
  workoutId: string;
  onUpdate: (next: CircuitGroup) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddExercise: () => void;
  onEditExercise: (exercise: Exercise) => void;
  // See SetRows: "template" mode drops history-driven prefill/PBs/history list.
  mode?: "workout" | "template";
}

export function CircuitRows({
  circuit,
  workoutId,
  onUpdate,
  onRemove,
  onDuplicate,
  onAddExercise,
  onEditExercise,
  mode = "workout",
}: Props) {
  const isTemplate = mode === "template";
  const timer = useTimer();
  // `round` is the 0-based round the tray is editing, or null for "every round"
  // (the default, unsplit case — see circuit-segments.ts).
  const [activeTray, setActiveTray] = useState<
    {
      exIdx: number;
      round: number | null;
      draft: DraftSet;
      suggestion: DraftSet | null;
      // Whether this round has no logged values yet — drives the tray's
      // "Add set" vs "Save changes" wording. Circuit sets often have no `id`
      // even once they hold real values (ids are assigned on save, not on
      // edit), so this can't be inferred from `draft.id` the way the
      // non-circuit tray does.
      isNew: boolean;
    } | null
  >(null);
  // Which exercise is asking "which round are you changing?" before its tray.
  const [roundPickerFor, setRoundPickerFor] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Cache of the previous session's first set per exerciseId, populated as
  // exercises are discovered. Drives the suggestion placeholders shown when
  // the tray is opened for manual entry (circuit exercises don't get the
  // tap-to-harden "ghost" row — see SetRows for that feature). Held in a
  // ref (fetch-dedupe by key); `cacheVersion` re-renders once values land.
  const lastByExerciseRef = useRef<Map<string, DraftSet>>(new Map());
  const [, bumpCache] = useState(0);

  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    // Fetch the first set of the last session that logged each exercise (even
    // if that session wasn't a circuit) for any exercise not yet cached.
    const toFetch = circuit.exercises.filter(
      (eg) => !lastByExerciseRef.current.has(eg.exerciseId)
    );
    if (toFetch.length === 0) return;

    Promise.all(
      toFetch.map((eg) =>
        getLastSessionSetsForExercise(eg.exerciseId, workoutId)
          .then((rows) => ({ exerciseId: eg.exerciseId, set: rows[0] ?? null }))
          .catch((err) => {
            console.error("[circuit-rows] failed to load last set:", err);
            return { exerciseId: eg.exerciseId, set: null };
          })
      )
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) {
        if (!r.set) {
          lastByExerciseRef.current.set(r.exerciseId, makeEmptyDraft(r.exerciseId));
          continue;
        }
        lastByExerciseRef.current.set(r.exerciseId, {
          exerciseId: r.exerciseId,
          reps: r.set.reps,
          weightKg: r.set.weightKg,
          bodyweightKg: r.set.bodyweightKg,
          distanceKm: r.set.distanceKm,
          durationSec: r.set.durationSec,
          resistance: r.set.resistance,
          speedMs: r.set.speedMs,
          inclinePct: r.set.inclinePct,
          restSec: r.set.restSec,
          calories: r.set.calories,
          rpe: r.set.rpe,
          steps: r.set.steps,
          heightM: r.set.heightM,
        });
      }
      bumpCache((n) => n + 1);
    });

    return () => {
      cancelled = true;
    };
    // Re-run when the list of exerciseIds changes (e.g., an exercise is added).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit.exercises.map((e) => e.exerciseId).join("|"), workoutId]);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: circuit.groupKey });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const { setNodeRef: setBodyDroppableRef, isOver: isBodyOver } = useDroppable({
    id: circuitBodyId(circuit.groupKey),
  });

  // Opens the set tray for one round of an exercise (null = all rounds at once).
  function openSetTray(exIdx: number, round: number | null) {
    // A template is an exercise list only — nothing to log against a circuit
    // exercise until it becomes a session (see SetRows' `displaySets`).
    if (isTemplate) return;
    const eg = circuit.exercises[exIdx];
    const existing =
      round == null ? eg.sets[0] : roundValues(normalizeSegments(eg.sets, circuit.rounds), round);
    const draft: DraftSet = existing ? { ...existing } : makeEmptyDraft(eg.exerciseId);
    const cached = lastByExerciseRef.current.get(eg.exerciseId) ?? null;
    const isNew = isBlankSet(draft);
    // Only suggest when there's nothing in the draft yet — otherwise the tray
    // is editing an in-progress set.
    setActiveTray({ exIdx, round, draft, suggestion: isNew ? cached : null, isNew });
  }

  // Tapping a set: with a single set of values there's nothing to disambiguate,
  // so go straight to the tray (unchanged from before per-round values). Once
  // the rounds differ, ask which round is being changed first.
  function selectSet(exIdx: number) {
    if (isTemplate) return;
    const eg = circuit.exercises[exIdx];
    if (eg.sets.length > 1) {
      setRoundPickerFor(exIdx);
      return;
    }
    openSetTray(exIdx, null);
  }

  // "Split values" breaks the exercise straight into one set per round — all
  // carrying its current values — so the user can then tap whichever round
  // they want to change, rather than opening a tray up front.
  function splitValues(exIdx: number) {
    if (isTemplate) return;
    const eg = circuit.exercises[exIdx];
    const nextSets = expandAllRounds(eg.sets, circuit.rounds);
    const nextExercises = circuit.exercises.map((e, i) =>
      i === exIdx ? { ...e, sets: nextSets } : e
    );
    onUpdate({ ...circuit, exercises: nextExercises });
  }

  // "Consolidate values" is the reverse: collapse every round back to one set
  // of values, the same as picking "Every round the same" in the round picker.
  function consolidateValues(exIdx: number) {
    if (isTemplate) return;
    openSetTray(exIdx, null);
  }

  function confirmSetTray(draft: DraftSet) {
    if (!activeTray) return;
    const eg = circuit.exercises[activeTray.exIdx];
    const nextSets =
      activeTray.round == null
        ? setAllRoundValues(eg.sets, circuit.rounds, draft)
        : setRoundValues(normalizeSegments(eg.sets, circuit.rounds), activeTray.round, draft);
    const nextExercises = circuit.exercises.map((e, i) =>
      i === activeTray.exIdx ? { ...e, sets: nextSets } : e
    );
    onUpdate({ ...circuit, exercises: nextExercises });
    if (!isTemplate && eg.exercise.trackRest && draft.restSec != null) {
      timer.startRest(draft.restSec);
    }
    setActiveTray(null);
  }

  // Changing the round count re-fits every exercise's segments to it, so the
  // "×N"s always add up to the number of rounds shown at the top of the card.
  function changeRounds(rounds: number) {
    onUpdate({
      ...circuit,
      rounds,
      exercises: circuit.exercises.map((eg) => ({
        ...eg,
        sets: normalizeSegments(eg.sets, rounds),
      })),
    });
  }

  function removeExercise(exIdx: number) {
    const next = circuit.exercises.filter((_, i) => i !== exIdx);
    if (next.length === 0) {
      onRemove();
      return;
    }
    onUpdate({ ...circuit, exercises: next });
  }

  function duplicateExercise(exIdx: number) {
    const eg = circuit.exercises[exIdx];
    const copy: ExerciseGroup = {
      ...eg,
      groupKey: crypto.randomUUID(),
      sets: eg.sets.map((s) => ({ ...s, id: undefined })),
    };
    const next = [
      ...circuit.exercises.slice(0, exIdx + 1),
      copy,
      ...circuit.exercises.slice(exIdx + 1),
    ];
    onUpdate({ ...circuit, exercises: next });
  }

  function setExerciseVariation(exIdx: number, variation: string | null) {
    const nextExercises = circuit.exercises.map((eg, i) =>
      i === exIdx ? { ...eg, variation } : eg
    );
    onUpdate({ ...circuit, exercises: nextExercises });
  }

  return (
    <>
      <div ref={setNodeRef} style={dragStyle}>
        <Card className="border-dashed border-muted-foreground/30">
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {renamingName ? (
                  <input
                    ref={nameInputRef}
                    autoFocus
                    defaultValue={circuit.name}
                    onBlur={(e) => {
                      const val = e.target.value.trim() || "Circuit";
                      onUpdate({ ...circuit, name: val });
                      setRenamingName(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        setRenamingName(false);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-base font-medium text-primary bg-transparent border-b border-primary/40 outline-none w-32 min-w-0"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingName(true);
                    }}
                    className="block text-base font-medium text-primary hover:text-primary/70 text-left break-words"
                  >
                    {circuit.name}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-0 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(true);
                  }}
                  aria-label="Circuit options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  ref={setActivatorNodeRef}
                  {...attributes}
                  {...listeners}
                  style={{ touchAction: "none" }}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground cursor-grab touch-none"
                  aria-label="Drag to reorder circuit"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div
            ref={setBodyDroppableRef}
            className={`px-3 pb-3 flex flex-col gap-4 rounded-b-xl transition-colors ${
              isBodyOver ? "bg-primary/5" : ""
            }`}
          >
            {/* In the same gap-4 flex column as the exercises, so the counter→
                first-exercise spacing matches the spacing between exercises. */}
            <RoundsControl rounds={circuit.rounds} onChange={changeRounds} />
            <SortableContext
              items={circuit.exercises.map((eg) => eg.groupKey)}
              strategy={verticalListSortingStrategy}
            >
              {circuit.exercises.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">No exercises yet</p>
              )}
              {circuit.exercises.map((eg, i) => (
                <CircuitExerciseRow
                  key={eg.groupKey}
                  exGroup={eg}
                  rounds={circuit.rounds}
                  workoutId={workoutId}
                  mode={mode}
                  onClick={() => selectSet(i)}
                  onEditRound={(round) => openSetTray(i, round)}
                  onSplitValues={() => splitValues(i)}
                  onConsolidateValues={() => consolidateValues(i)}
                  onRemove={() => removeExercise(i)}
                  onDuplicate={() => duplicateExercise(i)}
                  onEdit={() => onEditExercise(eg.exercise)}
                  onChangeVariation={(v) => setExerciseVariation(i, v)}
                />
              ))}
            </SortableContext>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAddExercise();
              }}
              className="self-center mt-1"
            >
              <Plus className="h-4 w-4" /> Add exercise
            </Button>
          </div>
        </Card>
      </div>

      {roundPickerFor != null && (
        <RoundPickerTray
          exGroup={circuit.exercises[roundPickerFor]}
          rounds={circuit.rounds}
          onPick={(round) => {
            const exIdx = roundPickerFor;
            setRoundPickerFor(null);
            openSetTray(exIdx, round);
          }}
          onClose={() => setRoundPickerFor(null)}
        />
      )}

      {activeTray && (
        <SetTray
          exercise={circuit.exercises[activeTray.exIdx].exercise}
          draft={activeTray.draft}
          suggestion={activeTray.suggestion}
          isNew={activeTray.isNew}
          isTemplate={isTemplate}
          onConfirm={confirmSetTray}
          onClose={() => setActiveTray(null)}
        />
      )}

      {menuOpen && (
        <CircuitMenu
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

// Full-width rounds stepper for a circuit card: a rounded bar with circular
// −/+ controls at each edge and the count (with a label) centred between them.
function RoundsControl({
  rounds,
  onChange,
  className = "",
}: {
  rounds: number;
  onChange: (rounds: number) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl bg-muted px-2 py-1.5 ${className}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(Math.max(0, rounds - 1));
        }}
        disabled={rounds <= 0}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-white"
        aria-label="Decrease rounds"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="text-base font-medium tabular-nums text-primary">
        {rounds} {rounds === 1 ? "round" : "rounds"}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(Math.min(999, rounds + 1));
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90"
        aria-label="Increase rounds"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function CircuitExerciseRow({
  exGroup,
  rounds,
  workoutId,
  mode = "workout",
  onClick,
  onEditRound,
  onSplitValues,
  onConsolidateValues,
  onRemove,
  onDuplicate,
  onEdit,
  onChangeVariation,
}: {
  exGroup: ExerciseGroup;
  rounds: number;
  workoutId: string;
  mode?: "workout" | "template";
  onClick: () => void;
  // Opens the set tray for one round (0-based) of this exercise.
  onEditRound: (round: number) => void;
  onSplitValues: () => void;
  onConsolidateValues: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onChangeVariation: (variation: string | null) => void;
}) {
  const navigate = useNavigate();
  const isTemplate = mode === "template";
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Prior sets for this exercise (excluding the current workout) so we can flag
  // PBs hit by the set being logged here — same logic as the non-circuit rows.
  const [priorSetsAsc, setPriorSetsAsc] = useState<WorkoutSet[] | null>(null);
  useEffect(() => {
    if (isTemplate) return;
    let cancelled = false;
    getExerciseHistory(exGroup.exerciseId, workoutId)
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
        console.error("[circuit-rows] failed to load PB history:", err);
        setPriorSetsAsc([]);
      });
    return () => {
      cancelled = true;
    };
  }, [exGroup.exerciseId, workoutId]);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: exGroup.groupKey,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // The exercise's round segments: one entry per distinct set of values, each
  // covering `rounds` consecutive rounds of the circuit.
  const segments = useMemo(
    () => normalizeSegments(exGroup.sets, rounds),
    [exGroup.sets, rounds]
  );

  const pbs = useMemo<PBType[][]>(() => {
    if (priorSetsAsc === null || segments.length === 0) return [];
    // The sets carry no per-set variation (it's chosen once for the whole
    // group), so stamp the group's current selection onto them before scoring.
    const combined = [
      ...priorSetsAsc,
      ...segments.map((s) => ({ ...s, variation: exGroup.variation })),
    ];
    const all = computePBsInOrder(combined, exGroup.exercise);
    return segments.map((_, i) => all[priorSetsAsc.length + i] ?? []);
  }, [priorSetsAsc, segments, exGroup.exercise, exGroup.variation]);
  // Templates carry no set values (legacy ones may still hold some until the
  // template is next saved — they're ignored here and by applyTemplate).
  const loggedSegments = isTemplate ? [] : segments.filter((s) => !isBlankSet(s));
  const hasData = loggedSegments.length > 0;
  // While every round shares the same values there's one summary line, as
  // before. As soon as one round differs the rounds are listed out
  // individually — numbered like a normal exercise's sets — so it's clear
  // which round is which.
  const perRound = segments.length > 1;
  const roundRows = useMemo(() => {
    if (!perRound) return [];
    return segments.flatMap((s, segIdx) =>
      Array.from({ length: segmentRounds(s) }, () => ({ set: s, segIdx }))
    );
  }, [perRound, segments]);

  return (
    <>
      <div
        ref={setNodeRef}
        style={dragStyle}
        className="flex flex-col gap-1.5 rounded-md px-1 py-1.5 hover:bg-muted/50"
      >
        {/* Title row. The options/drag controls are absolutely positioned so
            they're out of flow: the row's height is therefore just the title's
            line height, and the flex-col gap-1.5 below is measured from the
            title's bottom — matching a normal exercise card. (In flow, the h-9
            buttons are taller than the title and would define the row's bottom,
            opening up extra space before the tags.) The controls are centred on
            the row so they stay dead-centre on the title; pr-[4.5rem] reserves
            room for them so a long/wrapping name doesn't slide underneath. */}
        <div className="relative flex items-center gap-2">
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 pr-[4.5rem]">
            <button
              type="button"
              onClick={onClick}
              className="text-left text-sm font-medium min-w-0"
            >
              {exGroup.exercise.name}
            </button>
            <VariationControl group={exGroup} onChange={onChangeVariation} />
          </div>
          <div className="absolute right-0 top-1/2 flex -translate-y-1/2 shrink-0 items-center">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Options for ${exGroup.exercise.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              style={{ touchAction: "none" }}
              className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground cursor-grab touch-none hover:bg-muted hover:text-foreground"
              aria-label={`Drag to reorder ${exGroup.exercise.name}`}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* flex (not the default inline flow) so the tags span is a flex child
            with no inline line box — otherwise the button inherits the
            document's 1.5 line-height and adds ~4px of leading above the tags,
            which reads as extra title→tags spacing versus a normal card. */}
        <button
          type="button"
          onClick={onClick}
          className="flex text-left min-w-0"
        >
          <span className="text-xs text-muted-foreground inline-flex flex-wrap items-center gap-0.5">
            <ExerciseMetaTags e={exGroup.exercise} />
            <VariationTag group={exGroup} onChange={onChangeVariation} />
          </span>
        </button>
        {/* Set detail. One bulleted line while every round shares the same
            values; once a round differs, every round gets its own numbered row
            (see circuit-segments.ts) and tapping one edits that round. */}
        {!isTemplate && hasData && !perRound && (
          <div className="mt-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={onClick}
              className="text-left text-sm pl-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 before:content-['•'] before:mr-2 before:text-muted-foreground"
            >
              <span>{formatCircuitSetSummary(segments[0], exGroup)}</span>
              <PBBadges types={pbs[0] ?? []} />
            </button>
          </div>
        )}
        {!isTemplate && hasData && perRound && (
          <div className="mt-2 flex flex-col gap-0.5">
            {roundRows.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
              >
                <span className="text-sm text-muted-foreground w-6 shrink-0 text-center">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onEditRound(i)}
                  className="flex-1 text-left text-sm py-0.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <span>
                    {isBlankSet(r.set) ? "—" : formatCircuitSetSummary(r.set, exGroup)}
                  </span>
                  <PBBadges types={pbs[r.segIdx] ?? []} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Bottom row: a button that's always labelled — "Split values" to break
            the exercise into one set per round, ready to edit whichever round
            changes, or "Consolidate values" to collapse a split exercise back
            to one set of values — alongside the
            history chevron, so the two share a row instead of the chevron
            floating beside the set lines above. mt-3 (on top of the parent's
            gap-1.5) opens up extra room above this row so it doesn't read as
            part of the set-detail block. */}
        {!isTemplate && (
          <div className={`flex items-center justify-between ${hasData ? "" : "mt-2 min-h-9"}`}>
            {hasData ? (
              perRound ? (
                <button
                  type="button"
                  onClick={onConsolidateValues}
                  className="inline-flex items-center gap-1 pl-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Merge className="h-3 w-3" /> Consolidate values
                </button>
              ) : canSplitRound(segments, rounds) ? (
                <button
                  type="button"
                  onClick={onSplitValues}
                  className="inline-flex items-center gap-1 pl-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> Split values
                </button>
              ) : (
                <span />
              )
            ) : (
              // A freshly-added exercise has no data yet — `onClick` is the same
              // handler the title/tags use, which opens the tray pre-filled with
              // the same suggestion logic as every other "Add set" in the app
              // (see openSetTray).
              <button
                type="button"
                onClick={onClick}
                className="inline-flex items-center gap-1 pl-3 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Add set
              </button>
            )}
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              aria-label={historyOpen ? "Hide history" : "Show history"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {historyOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {!isTemplate && historyOpen && (
        <div className="border-t border-border mx-1">
          <ExerciseHistoryList
            exerciseId={exGroup.exerciseId}
            exercise={exGroup.exercise}
            excludeWorkoutId={workoutId}
            futureSets={exGroup.sets.map((s) => ({ ...s, variation: exGroup.variation }))}
          />
        </div>
      )}

      {menuOpen && (
        <CircuitExerciseMenu
          onViewStats={() => {
            setMenuOpen(false);
            navigate(
              `/exercises/${exGroup.exerciseId}?from=${isTemplate ? "/templates" : "/log"}/${workoutId}`
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

// Asked before the set tray when an exercise's rounds don't all share the same
// values: which round is being changed? Picking "every round" collapses them
// back to one set of values.
function RoundPickerTray({
  exGroup,
  rounds,
  onPick,
  onClose,
}: {
  exGroup: ExerciseGroup;
  rounds: number;
  // null = every round.
  onPick: (round: number | null) => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const segments = normalizeSegments(exGroup.sets, rounds);
  const ranges = segmentRanges(segments);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="px-4 pt-3">
          <h2 className="font-semibold">Which round?</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{exGroup.exercise.name}</p>
        </div>
        <div className="flex flex-col py-4 gap-1 px-4 max-h-[60vh] overflow-y-auto">
          {segments.flatMap((s, si) =>
            Array.from({ length: segmentRounds(s) }, (_, k) => {
              const round = ranges[si].from + k;
              return (
                <button
                  key={round}
                  type="button"
                  onClick={() => onPick(round - 1)}
                  className="w-full flex items-baseline justify-between gap-3 py-3 px-3 text-left rounded-xl hover:bg-muted/50"
                >
                  <span className="text-base font-medium shrink-0">Round {round}</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {isBlankSet(s) ? "—" : formatCircuitSetSummary(s, exGroup)}
                  </span>
                </button>
              );
            })
          )}
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full py-3 px-3 mt-1 text-left text-base font-medium rounded-xl border border-border hover:bg-muted/50"
          >
            Every round the same
          </button>
        </div>
      </div>
    </>
  );
}

function formatCircuitSetSummary(set: DraftSet, eg: ExerciseGroup): string {
  const ex = eg.exercise;
  const parts: string[] = [];
  const weightPart = formatWeightPart(set, ex);
  if (weightPart) parts.push(weightPart);
  if (ex.trackReps && set.reps != null)
    parts.push(`${set.reps} reps${ex.doubleReps ? " x2" : ""}`);
  if (ex.trackTime && set.durationSec != null) parts.push(formatDuration(set.durationSec));
  if (ex.trackResistance && set.resistance != null) parts.push(`res ${set.resistance}`);
  if (ex.trackIncline && set.inclinePct != null) {
    parts.push(
      ex.inclineUnit === "setting" ? `${set.inclinePct} incline` : `${set.inclinePct}%`
    );
  }
  if (ex.heightUnit && set.heightM != null) {
    const unit = ex.heightUnit as HeightUnit;
    parts.push(`${mToHeight(set.heightM, unit)} ${unit}`);
  }
  if (ex.trackSteps && set.steps != null) parts.push(`${set.steps} steps`);
  if (ex.trackRpe && set.rpe != null) parts.push(`RPE ${set.rpe}`);
  return parts.join(" · ") || "—";
}

function CircuitExerciseMenu({
  onViewStats,
  onEdit,
  onDuplicate,
  onRemove,
  onClose,
}: {
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

function CircuitMenu({
  onDuplicate,
  onRemove,
  onClose,
}: {
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
            onClick={onDuplicate}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Duplicate circuit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete circuit
          </button>
        </div>
      </div>
    </>
  );
}

function makeEmptyDraft(exerciseId: string): DraftSet {
  return {
    exerciseId,
    reps: null,
    weightKg: null,
    bodyweightKg: null,
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
  };
}
