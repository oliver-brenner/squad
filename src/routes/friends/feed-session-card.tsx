import { Link } from "react-router-dom";
import { format, parseISO, startOfWeek } from "date-fns";
import { Plus, Trophy } from "lucide-react";
import { PBBadges, NewBadge } from "@/components/pb-badge";
import { sessionTypeColor } from "@/lib/session-type-color";
import type { FeedSessionEntry } from "@/lib/db/queries";

type Props = {
  entry: FeedSessionEntry;
  isMine: boolean;
};

// One card per logged session (own or followee). Summarises the session and
// carries the author's running weekly context. Structured so a like / comment
// action bar can slot into the footer later without reworking the layout.
export function FeedSessionCard({ entry, isMine }: Props) {
  const author = entry.authorUsername
    ? `@${entry.authorUsername}`
    : entry.authorDisplayName ?? "Unknown";
  const initial = (entry.authorUsername ?? entry.authorDisplayName ?? "?")
    .slice(0, 1)
    .toUpperCase();
  const dateLabel = format(parseISO(entry.performedOn), "EEE d MMM");
  const sessionHref = isMine
    ? `/log/${entry.workoutId}?from=${encodeURIComponent("/friends")}`
    : `/friends/sessions/${entry.workoutId}`;

  // reps/volume are only meaningful for strength-ish sessions — hide the pills
  // when there's nothing to show so cardio/stretch cards stay clean.
  const stats: Array<{ value: string; label: string }> = [];
  if (entry.totalExercises > 0) {
    stats.push({ value: String(entry.totalExercises), label: "ex" });
    stats.push({ value: String(entry.totalSets), label: "sets" });
  }
  if (entry.totalReps > 0) stats.push({ value: withCommas(entry.totalReps), label: "reps" });
  if (entry.calories != null) stats.push({ value: String(entry.calories), label: "cals" });

  const newCount = entry.exercises.filter((ex) => ex.isNew).length;

  // "This week" for the current ISO week (Mon–Sun); otherwise the session's
  // week labelled by its Monday, since a card can be from a past week.
  const sessionMonday = startOfWeek(parseISO(entry.performedOn), { weekStartsOn: 1 });
  const isCurrentWeek =
    format(sessionMonday, "yyyy-MM-dd") ===
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekLabel = isCurrentWeek ? "This week" : `Week ${format(sessionMonday, "dd/MM")}`;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 p-3 pb-2">
        <Link
          to={`/users/${entry.authorId}?from=${encodeURIComponent("/friends")}`}
          className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
          aria-label={`${author}'s profile`}
        >
          {entry.authorAvatarUrl ? (
            <img
              src={entry.authorAvatarUrl}
              alt=""
              className="h-10 w-10 flex-shrink-0 rounded-full"
            />
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted font-medium">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{author}</div>
            <div className="truncate text-xs text-muted-foreground">{dateLabel}</div>
          </div>
        </Link>
        {(entry.totalPBs > 0 || newCount > 0) && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {entry.totalPBs > 0 && (
              <span
                className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                title={`${entry.totalPBs} personal best${entry.totalPBs === 1 ? "" : "s"}`}
              >
                <Trophy className="h-3.5 w-3.5" strokeWidth={2.5} />
                {entry.totalPBs}
              </span>
            )}
            {newCount > 0 && (
              <span
                className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                title={`${newCount} new exercise${newCount === 1 ? "" : "s"}`}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                {newCount}
              </span>
            )}
          </div>
        )}
      </header>

      <Link to={sessionHref} className="block transition-colors hover:bg-muted/30">
        <div className="px-4 pb-1">
          <div className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${sessionTypeColor(
                entry.sessionType ?? ""
              )}`}
            />
            <h3 className="min-w-0 flex-1 break-words text-base font-semibold leading-tight tracking-tight">
              {entry.workoutName || "Session"}
            </h3>
          </div>

          {entry.note && (
            <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted-foreground">
              {entry.note}
            </p>
          )}

          {stats.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {stats.map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70"
                >
                  <span className="font-semibold tabular-nums text-foreground/60">{s.value}</span>
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {entry.exercises.length > 0 && (
          <ul className="mt-2 flex flex-col divide-y divide-border border-t border-border">
            {entry.exercises.map((ex) => (
              <li
                key={ex.exerciseId}
                className="flex items-baseline justify-between gap-2 px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{ex.name}</div>
                  {ex.pbSetLabel && (
                    <div className="truncate text-xs text-muted-foreground">{ex.pbSetLabel}</div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {ex.pbTypes.length > 0 && <PBBadges types={ex.pbTypes} />}
                  {ex.isNew && <NewBadge />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Link>

      {/* Footer: the author's weekly context. Also the mount point for a future
          like / comment action bar — keep it a distinct bordered region. */}
      <footer className="border-t border-border px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          {weekLabel} · <span className="font-medium text-foreground/70">{entry.weekSessions}</span>{" "}
          {entry.weekSessions === 1 ? "session" : "sessions"}
          {entry.weekSets > 0 && (
            <>
              {" · "}
              <span className="font-medium text-foreground/70">{withCommas(entry.weekSets)}</span> sets
            </>
          )}
          {entry.weekReps > 0 && (
            <>
              {" · "}
              <span className="font-medium text-foreground/70">{withCommas(entry.weekReps)}</span> reps
            </>
          )}
        </p>
      </footer>
    </article>
  );
}

function withCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
