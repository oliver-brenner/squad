import { useEffect, useState } from "react";
import { Check, UserPlus, X } from "lucide-react";
import { useQuery } from "@powersync/react";
import { useAuth } from "@/lib/auth/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { uuid } from "@/lib/db/encoding";

// A guest being assembled on the new-session screen, before the workout exists.
// "user" = an on-Squad person you follow; "guest" = an off-Squad name.
export type DraftGuest =
  | { kind: "user"; profileId: string; name: string; avatarUrl: string | null }
  | { kind: "guest"; tempId: string; name: string };

type FollowProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

function FollowAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center font-medium flex-shrink-0">
      {(name.slice(0, 1) || "?").toUpperCase()}
    </div>
  );
}

export function GuestPickerSheet({
  selected,
  onChange,
  onClose,
}: {
  selected: DraftGuest[];
  onChange: (guests: DraftGuest[]) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const [visible, setVisible] = useState(false);
  const [addingOffSquad, setAddingOffSquad] = useState(false);
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const { data: following = [] } = useQuery<FollowProfileRow>(
    `SELECT p.id, p.username, p.display_name, p.avatar_url
     FROM follows f JOIN profiles p ON p.id = f.followee_id
     WHERE f.follower_id = ?
     ORDER BY LOWER(COALESCE(p.display_name, p.username, ''))`,
    [myId]
  );

  const selectedProfileIds = new Set(
    selected.filter((g) => g.kind === "user").map((g) => (g as { profileId: string }).profileId)
  );
  const offSquadGuests = selected.filter((g) => g.kind === "guest") as Array<{
    kind: "guest";
    tempId: string;
    name: string;
  }>;

  function toggleUser(row: FollowProfileRow) {
    const name = row.display_name ?? row.username ?? "Squad member";
    if (selectedProfileIds.has(row.id)) {
      onChange(selected.filter((g) => !(g.kind === "user" && g.profileId === row.id)));
    } else {
      onChange([...selected, { kind: "user", profileId: row.id, name, avatarUrl: row.avatar_url }]);
    }
  }

  function addOffSquad() {
    const name = guestName.trim();
    if (!name) return;
    onChange([...selected, { kind: "guest", tempId: uuid(), name }]);
    setGuestName("");
    setAddingOffSquad(false);
  }

  function removeOffSquad(tempId: string) {
    onChange(selected.filter((g) => !(g.kind === "guest" && g.tempId === tempId)));
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] flex flex-col rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted flex-shrink-0" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <h2 className="text-base font-semibold">Add guests</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Done"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-6 flex flex-col gap-1">
          {following.length === 0 && offSquadGuests.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">
              You're not following anyone yet — add a guest who isn't on Squad below.
            </p>
          )}

          {following.map((row) => {
            const name = row.display_name ?? row.username ?? "Squad member";
            const handle = row.username ? `@${row.username}` : name;
            const isSelected = selectedProfileIds.has(row.id);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => toggleUser(row)}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted/50"
              >
                <FollowAvatar name={name} avatarUrl={row.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{handle}</div>
                  {row.username && row.display_name && (
                    <div className="truncate text-sm text-muted-foreground">{row.display_name}</div>
                  )}
                </div>
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border flex-shrink-0 ${
                    isSelected ? "bg-foreground border-foreground text-background" : "border-border"
                  }`}
                >
                  {isSelected && <Check className="h-4 w-4" />}
                </div>
              </button>
            );
          })}

          {offSquadGuests.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {offSquadGuests.map((g) => (
                <div
                  key={g.tempId}
                  className="flex items-center gap-3 rounded-xl px-2 py-2"
                >
                  <FollowAvatar name={g.name} avatarUrl={null} />
                  <div className="min-w-0 flex-1 truncate font-medium">{g.name}</div>
                  <button
                    type="button"
                    onClick={() => removeOffSquad(g.tempId)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted flex-shrink-0"
                    aria-label={`Remove ${g.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 border-t border-border pt-3">
            {addingOffSquad ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Guest's name"
                  maxLength={80}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addOffSquad();
                  }}
                />
                <Button type="button" onClick={addOffSquad} disabled={!guestName.trim()}>
                  Add
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingOffSquad(true)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left font-medium hover:bg-muted/50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                  <UserPlus className="h-5 w-5" />
                </span>
                Add a guest not on Squad
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
