import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerSyncContext } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { powersync, powerSyncReady } from "./client";
import { SupabaseConnector } from "./connector";
import { bootstrapIfNeeded } from "./bootstrap";
import { backfillLegacySetBodyweight } from "./backfill";

// localStorage key for the last-connected PowerSync user. We only wipe the
// local DB when this changes — *not* on every user→null transition, because
// mobile Safari can emit transient SIGNED_OUT during token refresh and we
// don't want to nuke local data every time that happens.
//
// The `.v2` suffix marks the OPFS migration: pre-migration markers pointed
// at IDB storage which is now unused, so we want the first post-migration
// load to go through the full bootstrap path against fresh OPFS storage.
const LAST_USER_KEY = "squad.lastConnectedUserId.v2";

function readLastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function writeLastUser(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_USER_KEY, id);
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // localStorage may be unavailable (private mode); proceeding without it
    // just means we won't auto-clear on cross-user swap.
  }
}

// Nuke every trace of local state without going through PowerSync, which is
// the point: this runs when PowerSync itself won't open. Deletes the OPFS files
// backing squad.db, the connect marker, and any service-worker registration
// (the PWA caches the app shell, and a half-broken shell survives a reload).
async function clearLocalStorageAndDb(): Promise<void> {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    localStorage.removeItem("squad.lastConnectedUserId");
  } catch {
    // localStorage may be unavailable — nothing to clean up in that case.
  }

  try {
    const root = await navigator.storage.getDirectory();
    // @ts-expect-error — values() is available in browsers but not yet in the
    // TS DOM lib for FileSystemDirectoryHandle.
    for await (const entry of root.values()) {
      try {
        await root.removeEntry(entry.name, { recursive: true });
      } catch (err) {
        // A lock held by another context can block removal — keep going so one
        // stuck file doesn't leave the rest behind.
        console.warn(`[powersync] couldn't remove OPFS entry ${entry.name}:`, err);
      }
    }
  } catch (err) {
    console.warn("[powersync] OPFS cleanup failed:", err);
  }

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    for (const reg of registrations ?? []) await reg.unregister();
  } catch (err) {
    console.warn("[powersync] service worker unregister failed:", err);
  }
}

// Local-first lifecycle.
//
// Goal: open the app, log a set, lock the phone, come back, keep logging —
// the local SQLite DB is the source of truth for the UI; sync is purely a
// background concern.
//
// Strategy:
//   - powersync.init() starts at module import (see powerSyncReady in
//     client.ts), in parallel with the React boot. By the time this provider
//     awaits it, init is typically already done.
//   - We only render children AFTER init resolves — anything before that
//     could let a useQuery fire against a partially-initialised wa-sqlite
//     worker, which on iOS Safari crashes the tab.
//   - For RETURNING users (LAST_USER_KEY matches the signed-in user) we skip
//     waitForFirstSync — bootstrap is fire-and-forget. connect() happens in
//     the background; the UI doesn't wait for the WebSocket.
//   - For FIRST-TIME users we await connect + bootstrap so the UI doesn't
//     paint with missing defaults.
//   - Transient user→null (mobile Safari token refresh hiccups) just calls
//     disconnect(). Never disconnectAndClear() — that only fires on a real
//     user-swap or explicit sign-out (handled in settings.tsx).
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  const connector = useMemo(() => {
    const url = import.meta.env.VITE_POWERSYNC_URL;
    if (!url) {
      console.warn("[powersync] VITE_POWERSYNC_URL is not set — sync disabled");
      return null;
    }
    return new SupabaseConnector(url);
  }, []);

  const userId = user?.id ?? null;

  // The marker's only remaining job is detecting a user swap (read inside
  // runOnce). It no longer selects between a blocking and a background setup
  // path — nothing blocks on the network now.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    const runOnce = async () => {
      // Await the eager init kicked off at module load. Idempotent — if it's
      // already done, this resolves immediately.
      //
      // Bounded, because OPFSCoopSyncVFS holds an exclusive lock on squad.db:
      // if another context still has it (the homescreen PWA's worker while a
      // Safari tab opens the same origin), init() never resolves. Unbounded,
      // that's an unrecoverable spinner; bounded, we can at least tell the user
      // what to do about it.
      const initialised = await Promise.race([
        powerSyncReady.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
      ]);
      if (cancelled) return;
      if (!initialised) {
        throw new Error(
          "The local database didn't open. Another copy of the app may still have it open — close other tabs and the homescreen app, then retry."
        );
      }

      if (!user || !connector) {
        await powersync.disconnect();
        return;
      }

      const previousUser = readLastUser();
      if (previousUser && previousUser !== user.id) {
        // Different user on this browser — wipe stale data so we don't leak
        // the previous user's rows.
        await powersync.disconnectAndClear();
        if (cancelled) return;
      }

      // Neither connect nor bootstrap gates rendering, on ANY path — including
      // a first sign-in on this device.
      //
      // This used to await both for first-time users "so the UI doesn't paint
      // with missing defaults". That made a stalled sync unrecoverable: signing
      // out clears the marker, so the next login takes the first-time branch,
      // and bootstrapIfNeeded awaits waitForFirstSync() — on a device whose
      // sync isn't completing, the spinner never goes away and there's no route
      // back into the app to fix it. Painting a briefly-empty exercise library
      // is a far better failure than a permanent lockout.
      powersync.connect(connector).catch((err) => {
        console.warn("[powersync] background connect failed:", err);
      });
      bootstrapIfNeeded(user).catch((err) => {
        console.warn("[powersync] background bootstrap failed:", err);
      });

      // Legacy sets logged before `sets.bodyweight_kg` existed get the profile
      // bodyweight filled in, so they show it against the set like new ones do
      // instead of reading as reps-only. Fire-and-forget behind first sync:
      // it's idempotent, so re-running it on a later launch is how sets that
      // stream down after this point get picked up.
      void (async () => {
        try {
          await powersync.waitForFirstSync();
          const filled = await backfillLegacySetBodyweight(user.id);
          if (filled > 0) {
            console.info(`[powersync] filled bodyweight on ${filled} legacy sets`);
          }
        } catch (err) {
          console.warn("[powersync] bodyweight backfill failed:", err);
        }
      })();

      writeLastUser(user.id);
    };

    (async () => {
      try {
        await runOnce();
        if (!cancelled) {
          setError(null);
          setReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[powersync] init failed, retrying once:", err);
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;
        try {
          await runOnce();
          if (!cancelled) {
            setError(null);
            setReady(true);
          }
        } catch (retryErr) {
          if (cancelled) return;
          console.error("[powersync] init failed after retry:", retryErr);
          setError(retryErr instanceof Error ? retryErr : new Error(String(retryErr)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Depend on userId (primitive) rather than the user object — supabase-js
    // emits a fresh user object on every TOKEN_REFRESHED / visibility event,
    // which would otherwise re-run connect() and thrash the DB on iOS Safari.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loading, connector, retryNonce]);

  // iOS Safari freezes the tab (and the shared-sync worker's WebSocket) when
  // the app is backgrounded or the phone locks. The socket is often dead on
  // resume without the client noticing promptly, which shows up as a feed
  // that's hours behind another device that stayed open. Nudge a reconnect
  // whenever we come back to the foreground or regain the network and find
  // ourselves disconnected — connect() is a no-op when already connected.
  useEffect(() => {
    if (!userId || !connector) return;

    const nudge = () => {
      if (document.visibilityState !== "visible") return;
      if (powersync.connected) return;
      powersync.connect(connector).catch((err) => {
        console.warn("[powersync] reconnect nudge failed:", err);
      });
    };

    document.addEventListener("visibilitychange", nudge);
    window.addEventListener("online", nudge);
    window.addEventListener("focus", nudge);
    return () => {
      document.removeEventListener("visibilitychange", nudge);
      window.removeEventListener("online", nudge);
      window.removeEventListener("focus", nudge);
    };
  }, [userId, connector]);

  if (error && !ready) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground max-w-sm">
          {error.message ||
            "Couldn't start the local database. Check your connection and try again."}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRetryNonce((n) => n + 1);
          }}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Retry
        </button>
        {/* Last resort when the local database is what's broken: throw it away
            and let the next load re-download from PowerSync. Everything here is
            a local cache of Postgres, so the only loss is writes that hadn't
            uploaded yet — and if we can't open the DB, those are unreachable
            anyway. */}
        <button
          type="button"
          onClick={async () => {
            await clearLocalStorageAndDb();
            window.location.reload();
          }}
          className="text-xs text-muted-foreground underline"
        >
          Clear local data and reload
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  return (
    <PowerSyncContext.Provider value={powersync}>{children}</PowerSyncContext.Provider>
  );
}
