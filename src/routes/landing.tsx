import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { supabase } from "@/lib/supabase/client";

export function Landing() {
  const { user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  // Dev-only credentials, exposed only in `npm run dev`. In production builds
  // import.meta.env.DEV is false and these are tree-shaken away.
  const devEmail = import.meta.env.DEV ? import.meta.env.VITE_DEV_LOGIN_EMAIL : undefined;
  const devPassword = import.meta.env.DEV ? import.meta.env.VITE_DEV_LOGIN_PASSWORD : undefined;

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

  async function devSignIn() {
    if (!devEmail || !devPassword) return;
    setSigningIn(true);
    setDevError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: devPassword,
    });
    if (error) {
      setDevError(error.message);
      setSigningIn(false);
    }
    // On success the auth listener flips `user` and we redirect via <Navigate>.
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
      {devEmail && devPassword && (
        <div className="flex flex-col items-center gap-2 w-full max-w-xs">
          <Button
            size="lg"
            variant="outline"
            onClick={devSignIn}
            disabled={signingIn}
            className="w-full"
          >
            Dev sign-in ({devEmail})
          </Button>
          {devError && <p className="text-sm text-destructive text-center">{devError}</p>}
        </div>
      )}
    </main>
  );
}
