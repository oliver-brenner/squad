// A circuit exercise's set list is a list of ROUND SEGMENTS: each set carries
// `rounds`, the number of consecutive circuit rounds performed with those
// values. The segments of one exercise always sum to the circuit's round count,
// so "3 rounds" with one segment reads "×3", and splitting round 3 out gives
// two segments — "×2" then "×1".
//
// This is what the per-set `circuit_rounds` column has always meant
// arithmetically (every stats query multiplies a set by it); before per-round
// values existed there was simply one segment per exercise carrying the whole
// count, which is why old sessions load unchanged.

import type { DraftSet } from "./workout-editor-types";

// Every field of a DraftSet that is a logged value — i.e. everything except
// the row identity (`id`) and the segment length (`rounds`). Two segments with
// equal values are indistinguishable to the user and get merged into one "×N".
const VALUE_KEYS = [
  "exerciseId",
  "reps",
  "weightKg",
  "bodyweightKg",
  "distanceKm",
  "durationSec",
  "resistance",
  "speedMs",
  "inclinePct",
  "restSec",
  "calories",
  "rpe",
  "steps",
  "heightM",
] as const satisfies readonly (keyof DraftSet)[];

export function sameSetValues(a: DraftSet, b: DraftSet): boolean {
  return VALUE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export function segmentRounds(s: DraftSet): number {
  return s.rounds ?? 1;
}

export function totalSegmentRounds(sets: DraftSet[]): number {
  return sets.reduce((n, s) => n + segmentRounds(s), 0);
}

// The 1-based round numbers a segment covers, e.g. { from: 3, to: 5 }.
export function segmentRanges(sets: DraftSet[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let next = 1;
  for (const s of sets) {
    const n = segmentRounds(s);
    out.push({ from: next, to: next + n - 1 });
    next += n;
  }
  return out;
}

// Force a set list to describe exactly `rounds` rounds. This is the safeguard
// the whole feature rests on: segments can never total more (trailing ones are
// dropped — those rounds are no longer performed) or less (the last segment
// absorbs the slack) than the circuit's round count.
//
// A lone set with no `rounds` of its own spans the whole circuit — that's the
// default, unsplit shape, and how sets logged before this feature (and sets
// dragged in from outside a circuit) are read.
export function normalizeSegments(sets: DraftSet[], rounds: number): DraftSet[] {
  if (sets.length === 0) return sets;
  if (rounds <= 0) return [{ ...sets[0], rounds: 0 }];

  const out: DraftSet[] = [];
  let used = 0;
  for (const s of sets) {
    if (used >= rounds) break;
    const want = s.rounds ?? (sets.length === 1 ? rounds : 1);
    const take = Math.min(Math.max(1, want), rounds - used);
    out.push({ ...s, rounds: take });
    used += take;
  }
  if (used < rounds) {
    const last = out[out.length - 1];
    out[out.length - 1] = { ...last, rounds: segmentRounds(last) + (rounds - used) };
  }
  return out;
}

// Segments → one entry per round. The first copy of a segment keeps its row id;
// the clones must not, or a split would insert duplicate primary keys.
export function expandSegments(sets: DraftSet[]): DraftSet[] {
  const out: DraftSet[] = [];
  for (const s of sets) {
    const n = segmentRounds(s);
    for (let i = 0; i < n; i++) {
      out.push({ ...s, id: i === 0 ? s.id : undefined, rounds: 1 });
    }
  }
  return out;
}

// One entry per round → segments, merging runs of identical values. This is
// what keeps the display collapsed to a single "×N" line whenever the user
// edits a round back to matching its neighbours.
function collapseRounds(rounds: DraftSet[]): DraftSet[] {
  const out: DraftSet[] = [];
  for (const r of rounds) {
    const last = out[out.length - 1];
    if (last && sameSetValues(last, r)) {
      out[out.length - 1] = { ...last, rounds: segmentRounds(last) + 1 };
      continue;
    }
    out.push({ ...r, rounds: 1 });
  }
  return out;
}

// The values performed in one round (0-based), or null if the round is out of
// range. The row id comes along only when this round is the segment's first —
// any other round is a copy that has no row of its own yet, so the set tray
// correctly treats it as a new set.
export function roundValues(sets: DraftSet[], roundIndex: number): DraftSet | null {
  let start = 0;
  for (const s of sets) {
    const n = segmentRounds(s);
    if (roundIndex < start + n) {
      return { ...s, id: roundIndex === start ? s.id : undefined, rounds: 1 };
    }
    start += n;
  }
  return null;
}

// Write `draft` into a single round (0-based) of an exercise's segment list,
// splitting and re-merging around it as needed.
export function setRoundValues(
  sets: DraftSet[],
  roundIndex: number,
  draft: DraftSet
): DraftSet[] {
  const expanded = expandSegments(sets);
  if (roundIndex < 0 || roundIndex >= expanded.length) return sets;
  expanded[roundIndex] = { ...draft, id: expanded[roundIndex].id, rounds: 1 };
  return collapseRounds(expanded);
}

// Collapse every round of an exercise back to one set of values.
export function setAllRoundValues(
  sets: DraftSet[],
  rounds: number,
  draft: DraftSet
): DraftSet[] {
  return [{ ...draft, id: sets[0]?.id, rounds: Math.max(0, rounds) }];
}

// Whether the exercise could still be split into per-round values — i.e. it
// isn't already down to one set per round. This is what enables the
// "Split values" button, and is the guard that stops the segments from ever
// outnumbering the circuit's rounds.
export function canSplitRound(sets: DraftSet[], rounds: number): boolean {
  return rounds >= 2 && sets.length > 0 && sets.length < rounds;
}

// "Split values": break the exercise into one set per round, all carrying the
// current values, so the user can then tap whichever round they want to
// change. Every round already has its own entry afterwards, so this always
// lands on exactly `rounds` sets — never more, never fewer.
export function expandAllRounds(sets: DraftSet[], rounds: number): DraftSet[] {
  return expandSegments(normalizeSegments(sets, rounds));
}
