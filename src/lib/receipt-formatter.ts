import Table from "cli-table3";
import { format as formatDate, parseISO } from "date-fns";
import type {
  SessionExportData,
  SessionExportSet,
  SessionExportExercise,
} from "@/lib/session-export";
import { computeSessionStats, type StatItem } from "@/lib/session-stats";

const WIDTH = 42;

function sep() {
  const line = "-".repeat(WIDTH);
  return line + "\n" + line;
}

function thinSep() {
  return "-".repeat(WIDTH);
}

function center(text: string): string {
  const clipped = text.slice(0, WIDTH);
  const pad = Math.max(0, WIDTH - clipped.length);
  return " ".repeat(Math.floor(pad / 2)) + clipped;
}

function titleInDashes(text: string): string {
  const label = ` ${text} `;
  if (label.length >= WIDTH) return label.slice(0, WIDTH);
  const remaining = WIDTH - label.length;
  const leftDashes = Math.floor(remaining / 2);
  const rightDashes = remaining - leftDashes;
  return "-".repeat(leftDashes) + label + "-".repeat(rightDashes);
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m} ${m === 1 ? "min" : "mins"}` : `${h}h`;
  if (m > 0) return `${m} ${m === 1 ? "min" : "mins"}`;
  return `${s} secs`;
}

function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : Number(n.toFixed(2)).toString();
}

function formatWeight(kg: number, defaultKg = 0): string {
  return `${fmt(kg + defaultKg)} kg`;
}

function wrapTagLine(tagStr: string, indent: string): string {
  if ((indent + tagStr).length <= WIDTH) return indent + tagStr + "\n";
  const contIndent = indent + " ";
  const lines: string[] = [];
  let remaining = tagStr;
  while (remaining.length > 0) {
    const avail = lines.length === 0 ? WIDTH - indent.length : WIDTH - contIndent.length;
    if (remaining.length <= avail) {
      lines.push(remaining);
      break;
    }
    const candidate = remaining.slice(0, avail);
    const cutDot = candidate.lastIndexOf(" · ");
    const cutComma = candidate.lastIndexOf(", ");
    const breakDot = cutDot !== -1 ? cutDot + 2 : -1;
    const breakComma = cutComma !== -1 ? cutComma + 1 : -1;
    let cut = Math.max(breakDot, breakComma);
    if (cut <= 0) cut = avail;
    lines.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^ /, "");
  }
  return lines.map((l, i) => (i === 0 ? indent : contIndent) + l).join("\n") + "\n";
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Number(km.toFixed(2)).toString()} km`;
}

function formatSpeed(ms: number): string {
  return `${Number((ms * 3.6).toFixed(1)).toString()} km/h`;
}

function buildSetTable(sets: SessionExportSet[], extraIndent = "", defaultWeightKg = 0): string {
  if (sets.length === 0) return `${extraIndent}  (no sets recorded)\n`;

  const hasWeight = sets.some((s) => s.weightKg !== null);
  const hasReps = sets.some((s) => s.reps !== null);
  const hasDist = sets.some((s) => s.distanceKm !== null);
  const hasDuration = sets.some((s) => s.durationSec !== null);
  const hasRes = sets.some((s) => s.resistance !== null);
  const hasSpeed = sets.some((s) => s.speedMs !== null);
  const hasIncline = sets.some((s) => s.inclinePct !== null);
  const hasRest = sets.some((s) => s.restSec !== null);

  const table = new Table({
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: `${extraIndent}  `,
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: "   ",
    },
    style: { head: [], border: [] },
  });

  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    const row: string[] = [String(i + 1) + "."];
    if (hasWeight) row.push(s.weightKg !== null ? formatWeight(s.weightKg, defaultWeightKg) : "—");
    if (hasReps) row.push(s.reps !== null ? `${s.reps} reps` : "—");
    if (hasDist) row.push(s.distanceKm !== null ? formatDistance(s.distanceKm) : "—");
    if (hasDuration) row.push(s.durationSec !== null ? formatDuration(s.durationSec) : "—");
    if (hasRes) row.push(s.resistance !== null ? `res ${s.resistance}` : "—");
    if (hasSpeed) row.push(s.speedMs !== null ? formatSpeed(s.speedMs) : "—");
    if (hasIncline) row.push(s.inclinePct !== null ? `${s.inclinePct}%` : "—");
    if (hasRest) row.push(s.restSec !== null ? formatDuration(s.restSec) + " rest" : "—");
    table.push(row);
  }

  return table.toString() + "\n";
}

function exerciseBlock(ex: SessionExportExercise, indent = ""): string {
  const tagParts: string[] = [];
  if (ex.categories && ex.categories.length > 0)
    tagParts.push(ex.categories.map((t) => t.toLowerCase()).join(", "));
  if (ex.equipment) tagParts.push(ex.equipment.toLowerCase());
  const allMuscles = [...(ex.muscles ?? []), ...(ex.secondaryMuscles ?? [])];
  if (allMuscles.length > 0) tagParts.push(allMuscles.map((t) => t.toLowerCase()).join(", "));
  if (ex.doubleReps) tagParts.push("x2");
  const tagLine = tagParts.length > 0 ? wrapTagLine(`[${tagParts.join(" · ")}]`, indent) : "";
  return `${indent}${ex.name.toUpperCase()}\n${tagLine}${buildSetTable(ex.sets, indent, ex.defaultWeightKg)}`;
}

function computeStats(data: SessionExportData) {
  const items: StatItem[] = data.items.map((item) =>
    item.type === "exercise"
      ? { type: "single", exercise: item.data }
      : { type: "circuit", rounds: item.rounds, exercises: item.exercises }
  );
  return computeSessionStats(items);
}

export function formatSessionReceipt(data: SessionExportData): string {
  const lines: string[] = [];

  const dateStr = (() => {
    try {
      return formatDate(parseISO(data.performedOn), "EEE d MMM yyyy");
    } catch {
      return data.performedOn;
    }
  })();

  const typeLabel: Record<string, string> = {
    workout: "Workout",
    stretch: "Stretch",
    sport: "Sport",
    lifestyle: "Lifestyle",
  };

  const { exercises: totalExercises, totalSets, totalReps } = computeStats(data);

  const statParts: string[] = [];
  if (totalExercises > 0) statParts.push(`${totalExercises} exercises`);
  if (totalSets > 0) statParts.push(`${totalSets} sets`);
  if (totalReps > 0) statParts.push(`${totalReps} reps`);

  lines.push(sep());
  lines.push(center(data.name.toUpperCase()));
  lines.push(center(`${dateStr}  ·  ${typeLabel[data.sessionType] ?? data.sessionType}`));
  if (statParts.length > 0) {
    lines.push(center(statParts.join("  ·  ")));
  }
  lines.push(thinSep());
  lines.push("");

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (i > 0) {
      lines.push(thinSep());
      lines.push("");
    }
    if (item.type === "exercise") {
      lines.push(exerciseBlock(item.data));
    } else {
      lines.push(`CIRCUIT: ${item.name.toUpperCase()}  ×${item.rounds}`);
      lines.push(thinSep());
      lines.push("");
      for (let j = 0; j < item.exercises.length; j++) {
        if (j > 0) {
          lines.push(thinSep());
          lines.push("");
        }
        lines.push(exerciseBlock(item.exercises[j], "  "));
      }
    }
  }
  lines.push("");

  if (data.notes?.trim()) {
    lines.push(thinSep());
    lines.push("NOTES");
    const words = data.notes.trim().split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line.length + word.length + 1 > WIDTH) {
        lines.push(line.trimEnd());
        line = word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    lines.push("");
  }

  lines.push(sep());

  // titleInDashes is unused in the formatter but kept for parity with gymtracker.
  void titleInDashes;

  return lines.join("\n");
}
