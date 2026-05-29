import { useEffect, useState, useTransition } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth/auth-context";
import { supabase } from "@/lib/supabase/client";
import { powersync } from "@/lib/db/client";
import { decodeProfile } from "@/lib/db/decoders";
import type { ProfileRow } from "@/lib/db/schema";
import {
  updateBodyweightKg,
  updateCalorieTrackingEnabled,
  updateUsername,
  validateUsername,
} from "@/lib/mutations/profile";

export function Settings() {
  const { user } = useAuth();
  const { data: profileRows } = useQuery<ProfileRow>(
    `SELECT * FROM profiles WHERE id = ? LIMIT 1`,
    [user?.id ?? ""]
  );
  const profile = profileRows[0] ? decodeProfile(profileRows[0]) : null;

  const fallbackName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "You";
  const displayedName = profile?.username ?? fallbackName;
  const initial = (displayedName || "Y").slice(0, 1).toUpperCase();

  return (
    <>
      <PageHeader title="Settings" backHref="/you" />

      <Card>
        <CardContent className="pt-6 flex items-center gap-4">
          {user?.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url as string}
              alt=""
              className="h-14 w-14 rounded-full"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center font-semibold text-lg">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{displayedName}</div>
            <div className="truncate text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </CardContent>
      </Card>

      <UsernameSection currentUsername={profile?.username ?? null} />

      <BodyweightSection currentBodyweightKg={profile?.bodyweightKg ?? null} />

      <CalorieTrackingSection enabled={profile?.calorieTrackingEnabled ?? false} />

      <Card className="mt-4 p-0">
        <Link
          to="/settings/fields"
          className="flex items-center gap-3 p-4 hover:bg-muted/50"
        >
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Customise fields</div>
            <div className="text-sm text-muted-foreground">
              Edit categories, equipment, and muscle groups
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </Card>

      <Button
        variant="outline"
        size="lg"
        className="w-full mt-4"
        onClick={async () => {
          // Explicit sign-out: wipe the local DB so the next user on this
          // browser doesn't inherit cached rows. The PowerSyncProvider no
          // longer does this on transient user→null transitions (mobile
          // Safari token refresh can briefly emit SIGNED_OUT).
          try {
            await powersync.disconnectAndClear();
          } catch (err) {
            console.error("[settings] disconnectAndClear failed:", err);
          }
          try {
            localStorage.removeItem("squad.lastConnectedUserId.v2");
            // Also clean up the pre-OPFS marker if it's still around.
            localStorage.removeItem("squad.lastConnectedUserId");
          } catch {
            // ignore — localStorage may be unavailable
          }
          await supabase.auth.signOut();
        }}
      >
        Sign out
      </Button>
    </>
  );
}

function UsernameSection({ currentUsername }: { currentUsername: string | null }) {
  const [draft, setDraft] = useState(currentUsername ?? "");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();

  // Keep the input synced with remote profile updates, but don't yank the
  // value out from under the user while they're typing.
  useEffect(() => {
    if (!focused) setDraft(currentUsername ?? "");
  }, [currentUsername, focused]);

  function commit() {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === (currentUsername ?? "")) {
      setError(null);
      return;
    }
    // Empty + had no prior username: nothing to do.
    if (trimmed === "" && currentUsername === null) {
      setError(null);
      return;
    }
    // Empty + had a prior username: clear it back to null.
    if (trimmed === "") {
      startTransition(async () => {
        try {
          await updateUsername(null);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't clear username");
        }
      });
      return;
    }
    const validationError = validateUsername(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      try {
        await updateUsername(trimmed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save username");
      }
    });
  }

  return (
    <Card className="mt-4 p-0">
      <div className="p-4">
        <div className="font-medium">Enter username</div>
        <label className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <span>@</span>
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(currentUsername ?? "");
                setError(null);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
            disabled={pending}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
        </label>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </Card>
  );
}

function CalorieTrackingSection({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      try {
        await updateCalorieTrackingEnabled(next);
      } catch (err) {
        console.error("[settings] updateCalorieTrackingEnabled failed:", err);
      }
    });
  }

  return (
    <Card className="mt-4 p-0">
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Enable calorie tracking</div>
          <div className="text-sm text-muted-foreground">
            Log calories burned on each session
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} disabled={pending} />
      </div>
    </Card>
  );
}

function BodyweightSection({
  currentBodyweightKg,
}: {
  currentBodyweightKg: number | null;
}) {
  const [draft, setDraft] = useState(
    currentBodyweightKg !== null ? String(currentBodyweightKg) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!focused) {
      setDraft(currentBodyweightKg !== null ? String(currentBodyweightKg) : "");
    }
  }, [currentBodyweightKg, focused]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (currentBodyweightKg === null) {
        setError(null);
        return;
      }
      startTransition(async () => {
        try {
          await updateBodyweightKg(null);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't clear bodyweight");
        }
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive number");
      return;
    }
    if (parsed === currentBodyweightKg) {
      setError(null);
      return;
    }
    startTransition(async () => {
      try {
        await updateBodyweightKg(parsed);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save bodyweight");
      }
    });
  }

  return (
    <Card className="mt-4 p-0">
      <div className="p-4">
        <div className="font-medium">Enter bodyweight</div>
        <label className="mt-1 flex items-baseline gap-1 text-sm text-muted-foreground">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(
                  currentBodyweightKg !== null ? String(currentBodyweightKg) : ""
                );
                setError(null);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="0"
            disabled={pending}
            style={{ width: `${Math.max(draft.length, 1)}ch` }}
            className="bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span>kg</span>
        </label>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </Card>
  );
}
