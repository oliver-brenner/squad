import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerSyncContext } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { powersync, powerSyncReady } from "./client";
import { SupabaseConnector } from "./connector";
import { bootstrapIfNeeded } from "./bootstrap";

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

  // Read the marker once at mount. If it matches, we already have local data
  // and can skip the network-blocking parts of setup.
  const initialMarker = useMemo(() => readLastUser(), []);
  const haveLocalDataForUser = userId !== null && initialMarker === userId;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    const runOnce = async () => {
      // Await the eager init kicked off at module load. Idempotent — if it's
      // already done, this resolves immediately.
      await powerSyncReady;
      if (cancelled) return;

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

      if (haveLocalDataForUser) {
        // Returning user: kick off connect + bootstrap in the background.
        // We render the app from the local DB now; sync catches up silently.
        powersync.connect(connector).catch((err) => {
          console.warn("[powersync] background connect failed:", err);
        });
        bootstrapIfNeeded(user).catch((err) => {
          console.warn("[powersync] background bootstrap failed:", err);
        });
      } else {
        // First sign-in on this device — wait for connect + bootstrap so the
        // UI doesn't paint with missing defaults.
        await powersync.connect(connector);
        if (cancelled) return;
        await bootstrapIfNeeded(user);
        if (cancelled) return;
      }

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

  if (error && !ready) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground max-w-sm">
          Couldn't start the local database. Check your connection and try again.
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
