import { Link, Navigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ProfileView } from "@/components/profile/profile-view";

export function You() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;

  return (
    <ProfileView
      userId={user.id}
      topRight={
        <Link
          to="/settings"
          className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </Link>
      }
    />
  );
}
