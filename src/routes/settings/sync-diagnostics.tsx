import { useEffect, useState } from "react";
import { useQuery, useStatus } from "@powersync/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { powersync } from "@/lib/db/client";
import { resetLocalDatabase } from "@/lib/db/reset";
import {
  getLastUploadFailure,
  onUploadFailureChange,
  type UploadFailure,
} from "@/lib/db/connector";

// Sync diagnostics — the answer to "is my data reaching Postgres, and is my
// friends' data reaching me?", readable on a phone without devtools.
//
// The two failure modes this exists to surface:
//   * A blocked upload queue. PowerSync's CRUD queue is strict FIFO, so one
//     rejected op (a column Postgres doesn't have, an RLS denial) stalls every
//     write behind it forever. Pending count stays non-zero and the last
//     upload error names the table.
//   * An empty followee bucket. If the followee_* sync rules aren't producing
//     rows, "following" is non-zero while their workouts/sets counts are 0.
export function SyncDiagnostics() {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const status = useStatus();

  const [pending, setPending] = useState<number | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(getLastUploadFailure);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => onUploadFailureChange(setFailure), []);

  // Poll rather than watch: the CRUD queue lives in PowerSync's internal
  // tables, which aren't exposed to the reactive query layer.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const stats = await powersync.getUploadQueueStats(false);
        if (!cancelled) setPending(stats.count);
      } catch {
        if (!cancelled) setPending(null);
      }
    };
    void read();
    const id = setInterval(read, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Row counts split by owner — mine vs everyone else's. Anything not mine
  // arrived through a followee_* bucket, so these are a direct read on whether
  // the sync rules are delivering.
  const { data: counts = [] } = useQuery<{
    following: number;
    followee_profiles: number;
    followee_workouts: number;
    followee_sets: number;
    my_workouts: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following,
       (SELECT COUNT(*) FROM profiles WHERE id <> ?1) AS followee_profiles,
       (SELECT COUNT(*) FROM workouts WHERE user_id <> ?1) AS followee_workouts,
       (SELECT COUNT(*) FROM sets WHERE user_id <> ?1) AS followee_sets,
       (SELECT COUNT(*) FROM workouts WHERE user_id = ?1) AS my_workouts`,
    [myId]
  );
  const c = counts[0];

  // A torn OPFS file (storage cleared or a tab killed mid-write) surfaces as
  // "powersync_control: internal SQLite call returned CORRUPT" on the download
  // path. No amount of reloading fixes it — the file has to be replaced — so
  // name it plainly rather than showing the raw error.
  const corrupt = /corrupt/i.test(status.dataFlowStatus.downloadError?.message ?? "");

  const connection = status.connected
    ? "Connected"
    : status.connecting
      ? "Connecting…"
      : "Offline";

  async function resetLocalData() {
    setResetting(true);
    // Wipes local SQLite (including the CRUD queue) and re-downloads every
    // bucket on the next load. Falls back to deleting the OPFS files directly
    // if PowerSync can't clear itself — see resetLocalDatabase.
    await resetLocalDatabase();
  }

  return (
    <Card className="mt-4">
      <CardContent className="pt-4 space-y-3">
        <div className="font-medium">Sync</div>

        <dl className="space-y-1.5 text-sm">
          <Row label="Connection" value={connection} />
          <Row
            label="Last full sync"
            value={
              status.lastSyncedAt
                ? status.lastSyncedAt.toLocaleString()
                : status.hasSynced
                  ? "Completed earlier"
                  : "Never"
            }
          />
          <Row
            label="Waiting to upload"
            value={pending === null ? "—" : String(pending)}
            tone={pending && pending > 0 ? "warn" : undefined}
          />
          {c && (
            <>
              <Row label="My sessions (local)" value={String(c.my_workouts)} />
              <Row label="Following" value={String(c.following)} />
              <Row
                label="Friends' sessions synced"
                value={`${c.followee_workouts} sessions · ${c.followee_sets} sets`}
                tone={c.following > 0 && c.followee_workouts === 0 ? "warn" : undefined}
              />
              <Row
                label="Friends' profiles synced"
                value={String(c.followee_profiles)}
                tone={c.following > 0 && c.followee_profiles === 0 ? "warn" : undefined}
              />
            </>
          )}
        </dl>

        {failure && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">
              Upload blocked on {failure.table} ({failure.op})
            </span>
            <br />
            {failure.message}
            <br />
            <span className="text-xs opacity-80">{failure.at.toLocaleTimeString()}</span>
          </p>
        )}

        {status.dataFlowStatus.downloadError && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">
              {corrupt ? "Local database is corrupt" : "Download error"}
            </span>
            <br />
            {corrupt
              ? "Nothing can be written to it, so no data will arrive until it's replaced. Re-sync from scratch below — it's a cache of the server, so there's nothing to lose."
              : status.dataFlowStatus.downloadError.message}
          </p>
        )}

        {confirmingReset ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {pending && pending > 0
                ? `This deletes the local database, including ${pending} change${pending === 1 ? "" : "s"} that haven't reached the server yet. Those will be lost.`
                : "This deletes the local database and re-downloads everything from PowerSync. Nothing on the server is affected."}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingReset(false)}
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={resetLocalData} disabled={resetting}>
                {resetting ? "Resetting…" : "Delete and re-sync"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setConfirmingReset(true)}
          >
            Re-sync from scratch
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === "warn" ? "text-right font-medium text-destructive" : "text-right font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}
