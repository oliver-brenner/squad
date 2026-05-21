import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { ProfileView } from "@/components/profile/profile-view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  if (!id || !UUID_RE.test(id)) return <Navigate to="/friends" replace />;

  const from = searchParams.get("from");
  const backHref = from?.startsWith("/") ? from : "/friends";

  return <ProfileView userId={id} backHref={backHref} />;
}
