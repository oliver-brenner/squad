import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Plus, LayoutTemplate, ChevronRight } from "lucide-react";
import { getRecentWorkoutsWithExercises, type WorkoutWithExercises } from "@/lib/db/queries";
import { PageHeader } from "@/components/nav/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionList } from "./session-list";

function safeDateLabel(iso: string): string {
  // A malformed/empty performed_on (e.g. from a bad copy) would make
  // parseISO → Invalid Date and format() throw "Invalid time value",
  // crashing the whole list render. Degrade to the raw value instead.
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return iso || "—";
    return format(d, "EEE d MMM");
  } catch {
    return iso || "—";
  }
}

export function Log() {
  const [sessions, setSessions] = useState<WorkoutWithExercises[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One-shot query — getRecentWorkoutsWithExercises does multi-step joins that
    // don't fit a simple reactive useQuery. Refreshed when component remounts.
    // A rejection here used to leave `sessions` null forever (infinite spinner
    // with no signal); surface it so the list degrades to a visible error.
    getRecentWorkoutsWithExercises(60)
      .then((rows) => {
        setError(null);
        setSessions(rows);
      })
      .catch((err) => {
        console.error("[log] failed to load sessions:", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return (
    <>
      <PageHeader title="Log" description="Your training sessions." />

      <div className="pt-2 pb-4">
        <Link to="/log/new" className="block w-full">
          <Button className="w-full" size="lg">
            <Plus className="h-4 w-4 mr-1" /> New session
          </Button>
        </Link>
      </div>

      <Link
        to="/templates"
        className="mb-6 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
      >
        <LayoutTemplate className="h-4 w-4" />
        <span className="flex-1">Templates</span>
        <ChevronRight className="h-4 w-4" />
      </Link>

      {error !== null ? (
        <Card className="p-6 text-center text-sm text-red-500 break-words">
          Couldn't load your sessions.
          <span className="mt-2 block text-xs text-muted-foreground">{error}</span>
        </Card>
      ) : sessions === null ? (
        <div className="py-8 flex justify-center">
          <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No sessions logged yet. Tap “New session” to start.
        </Card>
      ) : (
        <SessionList
          sessions={sessions.map((w) => ({
            id: w.id,
            name: w.name,
            dateLabel: safeDateLabel(w.performedOn),
            exerciseNames: w.exerciseNames,
            sessionType: w.sessionType,
            totalExercises: w.totalExercises,
            totalSets: w.totalSets,
            totalReps: w.totalReps,
            calories: w.calories,
            durationSec: w.durationSec,
          }))}
          onDeleted={(id) =>
            setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev)
          }
        />
      )}
    </>
  );
}
