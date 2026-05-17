import { Link } from "react-router-dom";
import { format, parseISO, startOfWeek, subDays } from "date-fns";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { decodeWorkout } from "@/lib/db/decoders";
import type { WorkoutRow } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/stats/stat-card";
import { sessionTypeColor } from "@/lib/session-type-color";
import { PageHeader } from "@/components/nav/page-header";
import { ActivityCalendar } from "./activity-calendar";
import { ExerciseBreakdown } from "./exercise-breakdown";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Dashboard() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const today = new Date();
  const weekStartIso = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const since30Iso = format(subDays(today, 29), "yyyy-MM-dd");

  const { data: weekWorkoutCount = [{ count: 0 }] } = useQuery<{ count: number }>(
    `SELECT COUNT(*) AS count FROM workouts
     WHERE user_id = ? AND performed_on >= ? AND session_type = 'workout'`,
    [userId, weekStartIso]
  );
  const weekWorkouts = weekWorkoutCount[0]?.count ?? 0;

  const { data: streakDays = [] } = useQuery<{ performed_on: string }>(
    `SELECT DISTINCT performed_on FROM workouts WHERE user_id = ?`,
    [userId]
  );

  const { data: recentRows = [] } = useQuery<WorkoutRow>(
    `SELECT * FROM workouts WHERE user_id = ?
     ORDER BY performed_on DESC, created_at DESC LIMIT 5`,
    [userId]
  );
  const recentWorkouts = recentRows.map(decodeWorkout);

  const { data: calendarDots = [] } = useQuery<{ performed_on: string; session_type: string }>(
    `SELECT performed_on, session_type FROM workouts
     WHERE user_id = ? AND performed_on >= ? ORDER BY performed_on ASC`,
    [userId, since30Iso]
  );

  const dayStreak = computeStreak(streakDays.map((r) => r.performed_on));

  return (
    <>
      <PageHeader title={greeting()} description="Here's your week so far." />

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="This week"
          value={
            <>
              {weekWorkouts}
              <span className="text-sm font-normal ml-1.5 text-muted-foreground">workouts</span>
            </>
          }
        />
        <StatCard
          label="session streak"
          value={
            <>
              {dayStreak}
              {dayStreak > 0 && " 🔥"}
            </>
          }
        />
      </div>

      <div className="mt-4">
        <ActivityCalendar
          dots={calendarDots.map((d) => ({
            performedOn: d.performed_on,
            sessionType: d.session_type,
          }))}
        />
      </div>

      <ExerciseBreakdown />

      <section className="mt-6 flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
        {recentWorkouts.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Nothing yet — your first workout is one tap away.
          </Card>
        ) : (
          <ul className="flex flex-col gap-1">
            {recentWorkouts.map((w) => (
              <li key={w.id}>
                <Link
                  to={`/log/${w.id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted/60"
                >
                  <span className="flex items-center gap-3 text-sm font-medium">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(w.sessionType)}`}
                    />
                    {w.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(w.performedOn), "EEE d MMM")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function computeStreak(dateStrings: string[]): number {
  if (dateStrings.length === 0) return 0;
  const active = new Set(dateStrings);

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (!active.has(toIso(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (active.has(toIso(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
