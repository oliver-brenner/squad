import { useEffect, useState } from "react";
import { Check, ChevronDown, Globe, Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// Note with a public/private toggle, editable via a bottom-sheet tray
// (NoteTray): a "+ Add note" button when empty, or the note in a bubble box
// when set — tapping the bubble reopens the tray to edit. `onChange` fires when
// the tray is confirmed; the parent owns persistence (the editor's debounced
// autosave).
//
// Variants:
//  - "bare": just the button/bubble, no wrapper. Used for the session note,
//    placed inline in the editor (below the guests row).
//  - "inline": the button/bubble inside a collapsible "Note" disclosure with a
//    top border. Used for the per-exercise note inside an exercise Card.
export function NoteField({
  value,
  isPublic,
  onChange,
  variant = "bare",
  placeholder = "Add a note…",
}: {
  value: string | null;
  isPublic: boolean;
  onChange: (value: string | null, isPublic: boolean) => void;
  variant?: "bare" | "inline";
  placeholder?: string;
}) {
  const hasNote = !!value && value.trim().length > 0;
  const [open, setOpen] = useState(hasNote);
  const [trayOpen, setTrayOpen] = useState(false);

  const content = hasNote ? (
    <>
      <button
        type="button"
        onClick={() => setTrayOpen(true)}
        className="w-full rounded-xl bg-muted/50 px-3 py-2 text-left text-sm whitespace-pre-wrap hover:bg-muted"
      >
        {value}
      </button>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {isPublic ? (
          <>
            <Globe className="h-3.5 w-3.5" /> Visible to friends
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5" /> Only you
          </>
        )}
      </span>
    </>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTrayOpen(true)}
      className="self-start text-muted-foreground"
    >
      <Plus className="h-4 w-4" /> Add note
    </Button>
  );

  const tray = trayOpen && (
    <NoteTray
      initialValue={value}
      initialPublic={isPublic}
      placeholder={placeholder}
      onConfirm={(v, p) => {
        onChange(v, p);
        setTrayOpen(false);
      }}
      onClose={() => setTrayOpen(false)}
    />
  );

  if (variant === "bare") {
    return (
      <div className="flex flex-col gap-2">
        {content}
        {tray}
      </div>
    );
  }

  // "inline": collapsible disclosure inside an exercise card.
  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-1 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note
          {hasNote && <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-1 pb-2 flex flex-col gap-2">{content}</div>}
      {tray}
    </div>
  );
}

// Bottom-sheet editor for a single note. Mirrors the SetTray sheet styling
// (slide-up, drag handle, overlay). Type the note, optionally flip visibility,
// then tap the tick to confirm. Clearing the text confirms as null (removes it).
export function NoteTray({
  initialValue,
  initialPublic,
  placeholder,
  onConfirm,
  onClose,
}: {
  initialValue: string | null;
  initialPublic: boolean;
  placeholder: string;
  onConfirm: (value: string | null, isPublic: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialValue ?? "");
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function handleConfirm() {
    onConfirm(text.trim() === "" ? null : text, isPublic);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out max-h-[85vh] overflow-y-auto ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="font-semibold">Note</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-4 flex flex-col gap-3">
          <Textarea
            autoFocus
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[120px]"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              {isPublic ? (
                <>
                  <Globe className="h-4 w-4" /> Visible to friends
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" /> Only you
                </>
              )}
            </span>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </div>

        <div className="px-4 pb-8">
          <Button onClick={handleConfirm} className="w-full" size="lg" aria-label="Save note">
            <Check className="h-5 w-5" /> Save note
          </Button>
        </div>
      </div>
    </>
  );
}
