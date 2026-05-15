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

  const connector = useMemo(() => {
    const url = import.meta.env.VITE_POWERSYNC_URL;
    if (!url) {
      console.warn("[powersync] VITE_POWERSYNC_URL is not set — sync disabled");
      return null;
    }
    return new SupabaseConnector(url);
  }, []);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    (async () => {
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
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading, connector]);

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
