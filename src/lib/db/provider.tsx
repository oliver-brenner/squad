import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PowerSyncContext } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { powersync } from "./client";
import { SupabaseConnector } from "./connector";
import { bootstrapIfNeeded } from "./bootstrap";

// Connects PowerSync when the user is signed in and disconnects on sign out.
// On sign out we disconnect *and* clear the local database — otherwise the
// next user on the same browser would inherit cached rows.
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const connector = useMemo(() => {
    const url = import.meta.env.VITE_POWERSYNC_URL;
    if (!url) {
      console.warn("[powersync] VITE_POWERSYNC_URL is not set — sync disabled");
      return null;
    }
    return new SupabaseConnector(url);
  }, []);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    (async () => {
      try {
        await powersync.init();
        if (cancelled) return;

        if (user && connector) {
          await powersync.connect(connector);
          // On first sign-in, seed the profile + default exercises + field options.
          // No-op for returning users (the existing profile row short-circuits).
          await bootstrapIfNeeded(user);
        } else {
          // No user → wipe local DB so the next person on this browser doesn't
          // inherit the previous user's data.
          await powersync.disconnectAndClear();
        }
        if (!cancelled) {
          setError(null);
          setReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[powersync] initialization failed:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
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

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground max-w-sm">
          Couldn't start the local database. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setReady(false);
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
