import { useEffect, useMemo, useState, useTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@powersync/react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import type { TemplateRow } from "@/lib/db/schema";
import { decodeTemplate } from "@/lib/db/decoders";
import type { Template } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/nav/page-header";
import { sessionTypeColor } from "@/lib/session-type-color";
import { deleteTemplate, renameTemplate } from "@/lib/mutations/templates";

type PreviewRow = { template_id: string; name: string };

export function TemplatesList() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { data: templateRows = [] } = useQuery<TemplateRow>(
    `SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );
  const templates = useMemo(() => templateRows.map(decodeTemplate), [templateRows]);

  // Exercise-name preview per template, in position order. One flat query,
  // grouped client-side — same shape as the session-list exercise summary.
  const { data: previewRows = [] } = useQuery<PreviewRow>(
    `SELECT ts.template_id AS template_id, e.name AS name
     FROM template_sets ts JOIN exercises e ON e.id = ts.exercise_id
     WHERE ts.user_id = ?
     ORDER BY ts.position ASC`,
    [userId]
  );
  const previewByTemplate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of previewRows) {
      const list = map.get(r.template_id) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      map.set(r.template_id, list);
    }
    return map;
  }, [previewRows]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Templates"
        description="Reusable session templates."
        backHref="/log"
      />
      <Link to="/templates/new" className="block">
        <Button size="lg" className="-mt-2 w-full">
          <Plus className="h-4 w-4" /> Create Template
        </Button>
      </Link>

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No templates yet. Create one here, or use “Save as Template” from a session.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              exerciseNames={previewByTemplate.get(t.id) ?? []}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  exerciseNames,
}: {
  template: Template;
  exerciseNames: string[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <li className="relative flex items-center rounded-2xl border border-border bg-card overflow-hidden">
      <Link to={`/templates/${template.id}`} className="flex flex-1 flex-col gap-1 p-4 pr-12 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${sessionTypeColor(template.sessionType)}`} />
          <div className="font-medium text-base min-w-0 flex-1 truncate">{template.name}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          {exerciseNames.length > 0
            ? exerciseNames.map((n) => n.toLowerCase()).join(" · ")
            : "No exercises yet"}
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        className="absolute right-0 top-0 bottom-0 flex items-center px-4 text-muted-foreground"
        aria-label={`Options for ${template.name}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {menuOpen && (
        <TemplateRowMenu
          template={template}
          onClose={() => setMenuOpen(false)}
          onRename={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
        />
      )}

      {renaming && (
        <RenameTemplateSheet template={template} onClose={() => setRenaming(false)} />
      )}
    </li>
  );
}

function TemplateRowMenu({
  template,
  onClose,
  onRename,
}: {
  template: Template;
  onClose: () => void;
  onRename: () => void;
}) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const itemClass = "w-full py-4 text-center text-base font-medium rounded-xl hover:bg-muted/50";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col py-4 gap-2 px-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/log/new?template=${template.id}`);
            }}
            className={itemClass}
          >
            Create session from template
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/templates/${template.id}`);
            }}
            className={itemClass}
          >
            Edit contents
          </button>
          <button type="button" onClick={onRename} className={itemClass}>
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              startTransition(async () => {
                await deleteTemplate(template.id);
              });
            }}
            className="w-full py-4 text-center text-base font-medium rounded-xl text-red-500 hover:bg-muted/50"
          >
            Delete template
          </button>
        </div>
      </div>
    </>
  );
}

function RenameTemplateSheet({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState(template.name);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await renameTemplate({ id: template.id, name: trimmed });
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
        <div className="flex flex-col gap-3 px-4 py-4">
          <h2 className="text-base font-semibold">Rename template</h2>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          <Button size="lg" disabled={!name.trim() || isPending} onClick={save} className="w-full">
            Save
          </Button>
        </div>
      </div>
    </>
  );
}
