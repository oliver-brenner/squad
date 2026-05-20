import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Trophy } from "lucide-react";
import { PBBadges } from "@/components/pb-badge";
import type { FeedPBHighlight } from "@/lib/db/queries";

type Props = {
  highlight: FeedPBHighlight;
  isMine: boolean;
};

export function FeedPBCard({ highlight, isMine }: Props) {
  const author = highlight.authorUsername
    ? `@${highlight.authorUsername}`
    : highlight.authorDisplayName ?? "Unknown";
  const initial = (highlight.authorUsername ?? highlight.authorDisplayName ?? "?")
    .slice(0, 1)
    .toUpperCase();
  const sessionHref = isMine
    ? `/log/${highlight.workoutId}?from=${encodeURIComponent("/friends")}`
    : `/friends/sessions/${highlight.workoutId}`;
  const pbCountLabel = `${highlight.totalPBs} ${highlight.totalPBs === 1 ? "PB" : "PBs"}`;
  const dateLabel = format(parseISO(highlight.performedOn), "EEE d MMM");

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-amber-500/20 bg-gradient-to-r from-transparent via-amber-500/5 to-amber-500/20 p-3 pr-5">
        <Link
          to={`/users/${highlight.authorId}`}
          className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
          aria-label={`${author}'s profile`}
        >
          {highlight.authorAvatarUrl ? (
            <img
              src={highlight.authorAvatarUrl}
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
            {highlight.workoutName && (
              <div className="break-words text-xs text-muted-foreground">
                {highlight.workoutName}
              </div>
            )}
            <div className="truncate text-xs text-muted-foreground">{dateLabel}</div>
          </div>
        </Link>
        <Link
          to={sessionHref}
          className="flex flex-shrink-0 items-center gap-2 hover:opacity-80"
        >
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/25 text-amber-700 dark:text-amber-300">
            <Trophy className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <span className="whitespace-nowrap text-sm font-semibold">{pbCountLabel}</span>
        </Link>
      </header>

      <Link to={sessionHref} className="block transition-colors hover:bg-muted/30">
        <ul className="flex flex-col divide-y divide-border">
          {highlight.exercises.map((ex) => (
            <li key={ex.exerciseId} className="px-4 py-2.5">
              <div className="mb-1 truncate text-sm font-medium">{ex.exerciseName}</div>
              <ul className="flex flex-col gap-1">
                {ex.sets.map((s) => (
                  <li key={s.setId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm text-muted-foreground">{s.setLabel}</span>
                    <PBBadges types={s.types} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Link>
    </article>
  );
}
