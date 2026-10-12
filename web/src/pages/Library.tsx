import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, CloudUpload, Plus, Trash2, X } from "lucide-react";
import { api, relativeTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { DocumentRow } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton, Spinner } from "../components/ui";
import { Bar, ConfirmDialog, Modal, ModalFooter, Page, PageTitle, Sheet, Tabs, linkClass, useLast, useWindowFileDrop } from "../components/workspace/primitives";
import { DocIcon, isPlainText } from "../components/workspace/fileType";

/** GET /api/documents rows; `visibility` and `mine` arrive with the v2 server and may be absent. */
type Doc = DocumentRow & { visibility?: "school" | "private"; mine?: boolean };
type Scope = "school" | "mine";

/** A file on its way up, or one the server couldn't read. */
interface Pending {
  key: string;
  name: string;
  error?: string;
}

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const isPrivate = (d: Doc) => d.mine === true && d.visibility === "private";
const isProcessing = (d: Doc) => d.status !== "error" && !d.error && d.embedded_count < d.chunk_count;
const isFailed = (d: Doc) => d.status === "error" || !!d.error;

export function Library() {
  const { user } = useAuth();
  const toast = useToast();
  const { refresh: refreshStatus } = useStatus();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [scope, setScope] = useState<Scope>("school");
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ documents: Doc[] }>("/api/documents")
      .then((r) => setDocs(r.documents))
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);
  useEffect(load, [load]);

  // Refresh while anything is still getting ready.
  const busy = !!docs?.some(isProcessing);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(load, 2500);
    return () => window.clearInterval(t);
  }, [busy, load]);

  const hasMine = !!docs?.some(isPrivate);
  useEffect(() => {
    if (!hasMine) setScope("school");
  }, [hasMine]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setAddOpen(false);
      const batch = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name }));
      setPending((p) => [...batch, ...p]);
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (scope === "mine") fd.append("visibility", "private");
      try {
        const r = await api.post<{ created: number[]; errors: { filename: string; error: string }[] }>("/api/documents", fd);
        const failed = new Map(r.errors.map((e) => [e.filename, e.error]));
        setPending((p) => p.flatMap((x) => (batch.some((b) => b.key === x.key) ? (failed.has(x.name) ? [{ ...x, error: failed.get(x.name) }] : []) : [x])));
        load();
        refreshStatus();
      } catch (e) {
        const msg = (e as Error).message;
        setPending((p) => p.map((x) => (batch.some((b) => b.key === x.key) ? { ...x, error: msg } : x)));
      }
    },
    [scope, load, refreshStatus],
  );

  const dragging = useWindowFileDrop(upload);

  async function remove(d: Doc) {
    setDeleting(true);
    try {
      await api.del(`/api/documents/${d.id}`);
      setDocs((ds) => ds?.filter((x) => x.id !== d.id) ?? ds);
      toast({ kind: "info", message: `Deleted “${d.title}”.` });
      refreshStatus();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setDeleting(false);
      setConfirm(null);
      setOpenId(null);
    }
  }

  const visible = useMemo(() => (docs ?? []).filter((d) => (scope === "mine" ? isPrivate(d) : !isPrivate(d))), [docs, scope]);
  const openDoc = docs?.find((d) => d.id === openId) ?? null;
  const canDelete = (d: Doc) => user?.role === "admin" || d.mine === true || (d.owner_id != null && d.owner_id === user?.id);
  const empty = docs !== null && visible.length === 0 && pending.length === 0;

  return (
    <Page>
      <PageTitle
        title="Documents"
        actions={
          // The empty state carries its own Add button: one primary action per screen.
          !empty && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Add
            </button>
          )
        }
      />

      {hasMine && (
        <div className="ws-rise mt-8">
          <Tabs
            label="Which documents"
            value={scope}
            onChange={setScope}
            items={[
              { id: "school", label: "School" },
              { id: "mine", label: "Mine" },
            ]}
          />
        </div>
      )}

      <div className={hasMine ? "mt-2" : "mt-10"}>
        {docs === null ? (
          <ul className="divide-y divide-line" aria-busy>
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-4 py-5">
                <Skeleton className="h-9 w-9" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <div className="ws-rise flex flex-col items-center py-24 text-center">
            <p className="text-base text-muted">{scope === "mine" ? "Files you attach to questions show up here." : "Add the handbooks and guides you want answers from."}</p>
            <button className="btn-primary mt-6" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Add
            </button>
          </div>
        ) : (
          <ul className="ws-stagger divide-y divide-line">
            {pending.map((p, i) => (
              <li key={p.key} style={{ ["--i" as string]: i }} className="flex items-center gap-4 py-5">
                <DocIcon filename={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base text-ink">{p.name}</div>
                  {p.error ? (
                    <div className="mt-0.5 text-sm text-danger" title={p.error}>
                      Couldn't read this file
                    </div>
                  ) : (
                    <Getting value={null} />
                  )}
                </div>
                {p.error && (
                  <button className="btn-ghost btn-icon h-8 w-8 text-faint" onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))} aria-label={`Dismiss ${p.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
            {visible.map((d, i) => (
              <DocItem key={d.id} d={d} i={i + pending.length} onOpen={() => setOpenId(d.id)} />
            ))}
          </ul>
        )}
      </div>

      {dragging && <DropOverlay />}

      <AddDialog open={addOpen} onOpenChange={setAddOpen} onFiles={upload} onPasted={load} privateUpload={scope === "mine"} />

      <DocSheet doc={openDoc} onClose={() => setOpenId(null)} onDelete={openDoc && canDelete(openDoc) ? () => setConfirm(openDoc) : undefined} />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.title ?? ""}”?`}
        body="The assistant will stop using it in answers."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => confirm && remove(confirm)}
      />
    </Page>
  );
}

/* ------------------------------------------------------------------ Row */

function Getting({ value }: { value: number | null }) {
  return (
    <div className="mt-1.5 flex items-center gap-3">
      <span className="shrink-0 text-sm text-muted">Getting ready…</span>
      <Bar value={value} className="max-w-[160px]" />
    </div>
  );
}

function meta(d: Doc) {
  return ["Added " + relativeTime(d.created_at), d.owner_name].filter(Boolean).join(" · ");
}

function DocItem({ d, i, onOpen }: { d: Doc; i: number; onOpen: () => void }) {
  const processing = isProcessing(d);
  return (
    <li style={{ ["--i" as string]: i }}>
      <button data-doc-row type="button" onClick={onOpen} className="group -mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-lg px-3 py-5 text-left transition-colors duration-100 hover:bg-subtle/60 focus-visible:bg-subtle/60">
        <DocIcon filename={d.filename} mime={d.mime} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-ink">{d.title}</span>
          {isFailed(d) ? (
            <span className="mt-0.5 block text-sm text-danger">Couldn't read this file</span>
          ) : processing ? (
            <Getting value={d.chunk_count ? (100 * d.embedded_count) / d.chunk_count : null} />
          ) : (
            <span className="mt-0.5 block truncate text-sm text-faint">{meta(d)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ Preview */

function DocSheet({ doc, onClose, onDelete }: { doc: Doc | null; onClose: () => void; onDelete?: () => void }) {
  const d = useLast(doc);
  const [text, setText] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!doc) return;
    let live = true;
    setText(undefined);
    excerpt(doc)
      .then((t) => live && setText(t))
      .catch(() => live && setText(null));
    return () => {
      live = false;
    };
  }, [doc]);

  if (!d) return null;
  return (
    <Sheet
      open={!!doc}
      onOpenChange={(o) => !o && onClose()}
      title={d.title}
      description={meta(d)}
      width={560}
      footer={
        <>
          <a className="btn-secondary" href={`/api/documents/${d.id}/file`}>
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Open original
          </a>
          {onDelete && (
            <button className="btn-danger ml-auto" onClick={onDelete}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Delete
            </button>
          )}
        </>
      }
    >
      {isFailed(d) ? (
        <p className="text-sm text-danger">Couldn't read this file. Try adding it again, or paste its text instead.</p>
      ) : text === undefined ? (
        <div className="space-y-3 pt-1" aria-busy>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[94%]" />
          <Skeleton className="h-3 w-[70%]" />
        </div>
      ) : text ? (
        <Readable text={text} />
      ) : (
        <p className="text-sm text-muted">Open the original to read this document.</p>
      )}
    </Sheet>
  );
}

/**
 * The first part of a document as readable text. Plain-text files are read directly; other types
 * use GET /api/documents/{id}/preview when the server offers it ({passages:[{heading,text}]}).
 */
async function excerpt(d: Doc): Promise<string | null> {
  if (isPlainText(d.filename, d.mime)) {
    const res = await fetch(`/api/documents/${d.id}/file`, { credentials: "same-origin" });
    if (!res.ok) return null;
    return clip(await res.text());
  }
  try {
    const r = await api.get<{ passages: { heading?: string; text: string }[] }>(`/api/documents/${d.id}/preview`);
    return clip(r.passages.map((p) => (p.heading ? `## ${p.heading}\n\n${p.text}` : p.text)).join("\n\n"));
  } catch {
    return null;
  }
}

function clip(s: string, max = 2400) {
  if (s.length <= max) return s.trim();
  const cut = s.lastIndexOf("\n\n", max);
  return s.slice(0, cut > max / 2 ? cut : max).trim() + "\n\n…";
}

/** Light Markdown: headings, paragraphs and list items. No raw HTML. */
function Readable({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-4 text-[15px] leading-[26px] text-ink">
      {blocks.map((b, i) => {
        const h = b.match(/^(#{1,6})\s+(.*)$/s);
        if (h) {
          return h[1].length === 1 ? null : (
            <h3 key={i} className={clsx("text-base font-medium text-ink", i > 0 && "pt-3")}>
              {strip(h[2])}
            </h3>
          );
        }
        if (/^([-*]|\d+\.)\s/.test(b))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-muted">
              {b.split("\n").map((l, j) => (
                <li key={j}>{strip(l.replace(/^([-*]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className={b === "…" ? "text-faint" : "text-muted"}>
            {strip(b)}
          </p>
        );
      })}
    </div>
  );
}

const strip = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

/* ------------------------------------------------------------------ Add */

function AddDialog({
  open,
  onOpenChange,
  onFiles,
  onPasted,
  privateUpload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onFiles: (files: File[]) => void;
  onPasted: () => void;
  privateUpload: boolean;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setPaste(false);
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      await api.post("/api/documents/text", { title: title.trim(), text, ...(privateUpload ? { visibility: "private" } : {}) });
      toast({ kind: "success", message: `Added “${title.trim()}”.` });
      setTitle("");
      setText("");
      onOpenChange(false);
      onPasted();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && !!title.trim() && !!text.trim();

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={paste ? "Paste text" : "Add documents"} width={paste ? 640 : 520}>
      {paste ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save();
          }}
        >
          <div className="space-y-4 px-6 pb-6 pt-4">
            <div>
              <label htmlFor="paste-title" className="field-label">
                Title
              </label>
              <input id="paste-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Testing accommodations memo" required />
            </div>
            <div>
              <label htmlFor="paste-text" className="field-label">
                Text
              </label>
              <textarea id="paste-text" className="input block min-h-[240px] resize-y py-2.5 text-sm leading-6" value={text} onChange={(e) => setText(e.target.value)} required />
            </div>
          </div>
          <ModalFooter>
            <button type="button" className={`${linkClass} mr-auto`} onClick={() => setPaste(false)}>
              Upload a file instead
            </button>
            <button className="btn-primary" disabled={!canSave}>
              {saving && <Spinner />} Add
            </button>
          </ModalFooter>
        </form>
      ) : (
        <div className="px-6 pb-6 pt-4">
          <button
            type="button"
            data-autofocus
            onClick={() => fileInput.current?.click()}
            className="group flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-14 text-center transition-colors duration-150 hover:border-ink/50 hover:bg-subtle/40 focus-visible:border-ink/50"
          >
            <CloudUpload className="h-6 w-6 text-faint transition-colors group-hover:text-ink" strokeWidth={1.5} aria-hidden />
            <span className="mt-3 text-base text-ink">
              <span className="hidden sm:inline">Drop files here or browse</span>
              <span className="sm:hidden">Choose files</span>
            </span>
            <span className="mt-1 text-sm text-faint">PDF, Word or text</span>
          </button>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && onFiles(Array.from(e.target.files))} />
          <button type="button" className={`${linkClass} mt-5`} onClick={() => setPaste(true)}>
            Paste text instead
          </button>
        </div>
      )}
    </Modal>
  );
}

function DropOverlay() {
  return (
    <div className="ws-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-bg/85 p-6">
      <div className="flex h-full max-h-[360px] w-full max-w-[560px] flex-col items-center justify-center rounded-lg border border-dashed border-ink/50 text-center">
        <CloudUpload className="h-7 w-7 text-ink" strokeWidth={1.5} aria-hidden />
        <div className="mt-4 text-xl font-normal text-ink">Drop to add</div>
      </div>
    </div>
  );
}
