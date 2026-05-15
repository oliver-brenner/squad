import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { supabase } from "@/lib/supabase/client";

export function Landing() {
  const { user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="h-5 w-5 rounded-full border-2 border-muted border-t-foreground animate-spin" />
      </div>
    );
  }

  if (user) return <Navigate to="/dashboard" replace />;

  async function signIn() {
    setSigningIn(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 gap-8">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">
        <div className="h-14 w-14 rounded-2xl bg-foreground text-background flex items-center justify-center text-2xl font-bold">
          SQ
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Squad</h1>
        <p className="text-muted-foreground">
          Log workouts, track PBs, and see what your friends are up to.
        </p>
      </div>
      <Button size="lg" onClick={signIn} disabled={signingIn} className="w-full max-w-xs">
        {signingIn ? "Redirecting…" : "Continue with Google"}
      </Button>
    </main>
  );
}
