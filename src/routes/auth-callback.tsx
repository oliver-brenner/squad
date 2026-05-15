import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase/client";

// supabase-js with `detectSessionInUrl: true` handles the OAuth code exchange
// automatically when this route mounts (it sees `?code=...` in the URL and
// exchanges it for a session). We just wait for that to resolve, then redirect.
export function AuthCallback() {
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error || !data.session) {
        setStatus("error");
        return;
      }
      setStatus("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "error") return <Navigate to="/?error=auth" replace />;
  if (status === "ok") return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
    </div>
  );
}
