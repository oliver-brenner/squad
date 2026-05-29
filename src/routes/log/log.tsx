import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Plus } from "lucide-react";
import { getRecentWorkoutsWithExercises, type WorkoutWithExercises } from "@/lib/db/queries";
import { PageHeader } from "@/components/nav/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionList } from "./session-list";

export function Log() {
  const [sessions, setSessions] = useState<WorkoutWithExercises[] | null>(null);

  useEffect(() => {
    // One-shot query — getRecentWorkoutsWithExercises does multi-step joins that
    // don't fit a simple reactive useQuery. Refreshed when component remounts.
    getRecentWorkoutsWithExercises(60).then(setSessions);
  }, []);

  return (
    <>
      <PageHeader title="Log" description="Your training sessions." />

      <div className="pt-2 pb-6">
        <Link to="/log/new" className="block w-full">
          <Button className="w-full" size="lg">
            <Plus className="h-4 w-4 mr-1" /> New session
          </Button>
        </Link>
      </div>

      {sessions === null ? (
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
            dateLabel: format(parseISO(w.performedOn), "EEE d MMM"),
            exerciseNames: w.exerciseNames,
            sessionType: w.sessionType,
            totalExercises: w.totalExercises,
            totalSets: w.totalSets,
            totalReps: w.totalReps,
            calories: w.calories,
          }))}
        />
      )}
    </>
  );
}
