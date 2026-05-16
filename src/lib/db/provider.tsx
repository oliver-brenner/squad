import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerSyncContext } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { powersync } from "./client";
import { SupabaseConnector } from "./connector";
import { bootstrapIfNeeded } from "./bootstrap";

// localStorage key for the last-connected PowerSync user. We only wipe the
// local DB when this changes — *not* on every user→null transition, because
// mobile Safari can emit transient SIGNED_OUT during token refresh and we
// don't want to nuke local data every time that happens.
const LAST_USER_KEY = "squad.lastConnectedUserId";

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
// no spinners, no flashes, no "refresh." The local SQLite DB is the source
// of truth for the UI; sync is purely a background concern.
//
// Strategy:
//   - If this device has already bootstrapped this user (LAST_USER_KEY marker
//     matches), we know there's local data — render children IMMEDIATELY and
//     do init/connect/sync invisibly in the background. PowerSync's own
//     reconnect logic handles backgrounded tabs and flaky networks.
//   - Only first-time sign-in / new device blocks on the first sync, because
//     there's no data to render yet.
//   - Transient user→null (mobile Safari token refresh hiccups) just calls
//     disconnect(). Never disconnectAndClear() — that only happens when a
//     genuinely different user signs in on the same browser, or on explicit
//     sign-out (handled in settings.tsx).
//   - Background failures are logged, not surfaced as errors — the app keeps
//     working from cache while PowerSync retries connection internally.
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

  // Read the marker once at mount. If it matches the user we're about to
  // render for, we can skip the blocking wait — local data exists.
  const initialMarker = useMemo(() => readLastUser(), []);
  const haveLocalDataForUser = userId !== null && initialMarker === userId;

  // `ready` starts true for returning users so the first paint is the app
  // itself, not a spinner. First-time users start false and we gate on
  // init/connect/bootstrap completing.
  const [ready, setReady] = useState(haveLocalDataForUser);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    const runOnce = async () => {
      await powersync.init();
      if (cancelled) return;

      if (!user || !connector) {
        // No user → stop syncing but keep local data intact. Transient
        // SIGNED_OUT on mobile Safari shouldn't destroy state.
        await powersync.disconnect();
        return;
      }

      const previousUser = readLastUser();
      if (previousUser && previousUser !== user.id) {
        // Different user on this browser — wipe stale data so we don't
        // leak the previous user's rows.
        await powersync.disconnectAndClear();
        if (cancelled) return;
      }

      await powersync.connect(connector);
      if (cancelled) return;

      if (haveLocalDataForUser) {
        // Returning user: bootstrap runs in the background as a safety net
        // (no-op via the existing-profile check). Don't await — the UI is
        // already live.
        bootstrapIfNeeded(user).catch((err) => {
          console.warn("[powersync] background bootstrap failed:", err);
        });
      } else {
        // First sign-in on this device: wait for initial sync + seed so we
        // don't paint an empty app and then have rows pop in.
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
        if (haveLocalDataForUser) {
          // App is already rendered from cache. PowerSync's internal retry
          // will recover when the network is back; nothing for us to do.
          console.warn("[powersync] background sync failed:", err);
          return;
        }
        // First-time path can't proceed without init. Retry once, then
        // surface an actionable error.
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
