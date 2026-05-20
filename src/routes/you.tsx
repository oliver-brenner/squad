import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth/auth-context";
import { ProfileView } from "@/components/profile/profile-view";

export function You() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;

  return <ProfileView userId={user.id} />;
}
