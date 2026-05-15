import { useState, useTransition, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { deleteWorkout } from "@/lib/mutations/workouts";
import { sessionTypeColor } from "@/lib/session-type-color";
import { SessionReceiptSheet } from "@/components/session-receipt-sheet";

interface SessionItem {
  id: string;
  name: string;
  dateLabel: string;
  exerciseNames: string[];
  sessionType: string;
  totalExercises: number;
  totalSets: number;
  totalReps: number;
}

function SessionMenu({
  session,
  onClose,
  onExport,
}: {
  session: SessionItem;
  onClose: () => void;
  onExport: () => void;
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

export function SessionList({ sessions }: { sessions: SessionItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
    </ul>
  );
}

function SessionRow({ session }: { session: SessionItem }) {
  const [open, setOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  return (
    <li className="relative flex items-center rounded-2xl border border-border bg-card overflow-hidden">
      <Link
        to={`/log/${session.id}`}
        className="flex flex-1 flex-col gap-1 p-4 pr-12 min-w-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(session.sessionType)}`}
          />
          <div className="font-medium text-base min-w-0 flex-1">{session.name}</div>
          <div className="text-sm text-muted-foreground shrink-0 ml-auto">
            {session.dateLabel}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {session.exerciseNames.map((n) => n.toLowerCase()).join(" · ")}
        </div>
        {(session.sessionType === "workout" || session.sessionType === "stretch") && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {[
              { value: session.totalExercises, label: "exercises" },
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
          </div>
        )}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="absolute right-0 top-0 bottom-0 flex items-center px-4 text-muted-foreground"
        aria-label={`Options for ${session.name}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <SessionMenu
          session={session}
          onClose={() => setOpen(false)}
          onExport={() => setReceiptOpen(true)}
        />
      )}
      {receiptOpen && (
        <SessionReceiptSheet workoutId={session.id} onClose={() => setReceiptOpen(false)} />
      )}
    </li>
  );
}
