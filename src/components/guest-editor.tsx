import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { GuestPickerSheet, type DraftGuest } from "@/components/guest-picker-sheet";
import type { GuestInput } from "@/lib/mutations/workouts";

// Maps the editor's draft guests to the mutation input shape (profileId for
// on-Squad users, name for off-Squad guests). Shared by every screen that
// saves guests so the conversion lives in one place.
export function draftGuestsToInput(guests: DraftGuest[]): GuestInput[] {
  return guests.map((g) => (g.kind === "user" ? { profileId: g.profileId } : { name: g.name }));
}

// Guest list editor used on both the new-session and edit-session screens:
// removable chips for the current guests plus a button that opens the picker
// tray. Purely controlled — the parent owns the DraftGuest[] state.
export function GuestEditor({
  guests,
  onChange,
}: {
  guests: DraftGuest[];
  onChange: (guests: DraftGuest[]) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  function removeGuest(g: DraftGuest) {
    onChange(
      guests.filter((x) =>
        g.kind === "user"
          ? !(x.kind === "user" && x.profileId === g.profileId)
          : !(x.kind === "guest" && x.tempId === g.tempId)
      )
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {guests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {guests.map((g) => {
            const key = g.kind === "user" ? g.profileId : g.tempId;
            const avatarUrl = g.kind === "user" ? g.avatarUrl : null;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-sm"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                    {(g.name.slice(0, 1) || "?").toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{g.name.split(/\s+/)[0]}</span>
                <button
                  type="button"
                  onClick={() => removeGuest(g)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${g.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="flex items-center justify-center gap-2 rounded-2xl border border-border py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50"
      >
        <UserPlus className="h-4 w-4" />
        {guests.length > 0 ? "Edit guests" : "Add guests"}
      </button>

      {sheetOpen && (
        <GuestPickerSheet
          selected={guests}
          onChange={onChange}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
