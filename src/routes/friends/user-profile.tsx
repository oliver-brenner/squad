import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { ProfileView } from "@/components/profile/profile-view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  if (!id || !UUID_RE.test(id)) return <Navigate to="/friends" replace />;

  return (
    <ProfileView
      userId={id}
      topLeft={
        <Link
          to="/friends"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      }
    />
  );
}
