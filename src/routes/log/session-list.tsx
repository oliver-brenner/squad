import { useState, useTransition, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { deleteWorkout } from "@/lib/mutations/workouts";
import { sessionTypeColor } from "@/lib/session-type-color";
import { formatSessionDuration } from "@/lib/set-format";
import { SessionReceiptSheet } from "@/components/session-receipt-sheet";
import { SessionGuests } from "@/components/session-guests";

interface SessionItem {
  id: string;
  name: string;
  dateLabel: string;
  exerciseNames: string[];
  sessionType: string;
  totalExercises: number;
  totalSets: number;
  totalReps: number;
  calories: number | null;
  durationSec: number | null;
}

function SessionMenu({
  session,
  onClose,
  onExport,
  onDeleted,
}: {
  session: SessionItem;
  onClose: () => void;
  onExport: () => void;
  onDeleted: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [, startTransition] = useTransition();

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
            onClick={() => {
              onClose();
              navigate(`/log/${session.id}/edit`);
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/log/new?copyFrom=${session.id}`);
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Copy session
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onExport();
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50"
          >
            Export receipt
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              startTransition(async () => {
                await deleteWorkout(session.id);
                onDeleted(session.id);
              });
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete session
          </button>
        </div>
      </div>
    </>
  );
}

type SessionListProps = {
  sessions: SessionItem[];
  // Where each row links to. Defaults to the owner's editor at `/log/:id`.
  // Friend-profile callers pass `/friends/sessions/:id` (the read-only view).
  linkHref?: (id: string) => string;
  // Whether to render the "···" menu (Edit / Copy / Export / Delete). Off on
  // friend profiles since none of those actions apply to someone else's session.
  showMenu?: boolean;
  // Called after a session is deleted so the caller can remove it from its list.
  onDeleted?: (id: string) => void;
};

export function SessionList({ sessions, linkHref, showMenu = true, onDeleted }: SessionListProps) {
  const href = linkHref ?? ((id: string) => `/log/${id}`);
  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          href={href(s.id)}
          showMenu={showMenu}
          onDeleted={onDeleted}
        />
      ))}
    </ul>
  );
}

function SessionRow({
  session,
  href,
  showMenu,
  onDeleted,
}: {
  session: SessionItem;
  href: string;
  showMenu: boolean;
  onDeleted?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const showPills =
    session.sessionType === "workout" || session.sessionType === "stretch";

  return (
    <li className="relative flex items-center rounded-2xl border border-border bg-card overflow-hidden">
      <Link to={href} className="flex flex-1 flex-col gap-1 p-4 min-w-0">
        <div className={`flex items-center gap-3 min-w-0 ${showMenu ? "pr-8" : ""}`}>
          <div
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(session.sessionType)}`}
          />
          <div className="font-medium text-base min-w-0 flex-1">{session.name}</div>
          <div className="text-sm text-muted-foreground shrink-0 ml-auto">
            {session.dateLabel}
          </div>
        </div>
        <SessionGuests workoutId={session.id} variant="card" />
        <div className="text-xs text-muted-foreground">
          {session.exerciseNames.map((n) => n.toLowerCase()).join(" · ")}
        </div>
        {(showPills || session.calories != null || session.durationSec != null) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {showPills &&
              [
                { value: session.totalExercises, label: "ex" },
                { value: session.totalSets, label: "sets" },
                { value: session.totalReps, label: "reps" },
              ].map(({ value, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70"
                >
                  <span className="font-semibold tabular-nums text-foreground/60">{value}</span>
                  {label}
                </span>
              ))}
            {session.calories != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70">
                <span className="font-semibold tabular-nums text-foreground/60">
                  {session.calories}
                </span>
                cals
              </span>
            )}
            {session.durationSec != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground/70">
                <span className="font-semibold tabular-nums text-foreground/60">
                  {formatSessionDuration(session.durationSec)}
                </span>
              </span>
            )}
          </div>
        )}
      </Link>
      {showMenu && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
            className="absolute right-2 top-3 flex h-8 w-8 items-center justify-center text-muted-foreground"
            aria-label={`Options for ${session.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {open && (
            <SessionMenu
              session={session}
              onClose={() => setOpen(false)}
              onExport={() => setReceiptOpen(true)}
              onDeleted={(id) => onDeleted?.(id)}
            />
          )}
          {receiptOpen && (
            <SessionReceiptSheet
              workoutId={session.id}
              onClose={() => setReceiptOpen(false)}
            />
          )}
        </>
      )}
    </li>
  );
}
