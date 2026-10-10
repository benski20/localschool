import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ClipboardPaste, FileText, Trash2, Upload } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { api, formatBytes, relativeTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { DocumentRow } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Badge, EmptyState, Field, PageHeader, Progress, Skeleton, Spinner } from "../components/ui";

interface IndexInfo {
  model: string;
  total_chunks: number;
  embedded_chunks: number;
  ready: boolean;
}

export function Library() {
  const { user } = useAuth();
  const toast = useToast();
  const { refresh: refreshStatus } = useStatus();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [index, setIndex] = useState<IndexInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .get<{ documents: DocumentRow[]; index: IndexInfo }>("/api/documents")
      .then((r) => {
        setDocs(r.documents);
        setIndex(r.index);
      })
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);

  useEffect(load, [load]);
  // While vectors are being built, refresh so progress is visible.
  useEffect(() => {
    if (!index || index.ready) return;
    const t = window.setInterval(load, 2500);
    return () => window.clearInterval(t);
  }, [index, load]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    setUploading(true);
    try {
      const r = await api.post<{ created: number[]; errors: { filename: string; error: string }[] }>("/api/documents", fd);
      if (r.created.length) toast({ kind: "success", message: `Added ${r.created.length} document${r.created.length === 1 ? "" : "s"}. Searchable now.` });
      r.errors.forEach((e) => toast({ kind: "error", message: `${e.filename}: ${e.error}` }));
      load();
      refreshStatus();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(d: DocumentRow) {
    // Optimistic remove with a short undo window before the delete is sent.
    setDocs((ds) => ds?.filter((x) => x.id !== d.id) ?? ds);
    let undone = false;
    toast({
      kind: "info",
      message: `Removed "${d.title}".`,
      action: { label: "Undo", run: () => { undone = true; load(); } },
    });
    window.setTimeout(async () => {
      if (undone) return;
      try {
        await api.del(`/api/documents/${d.id}`);
      } catch (e) {
        toast({ kind: "error", message: (e as Error).message });
      }
      load();
      refreshStatus();
    }, 5000);
  }

  const pct = index && index.total_chunks ? Math.round((100 * index.embedded_chunks) / index.total_chunks) : 100;

  return (
    <div
      className="mx-auto w-full max-w-[1040px] px-4 py-8 md:px-8 md:py-10"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Library"
        description="Policies, handbooks, curriculum and pacing guides. Everything here is searchable by the assistant, and every answer cites the passage it came from."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="h-4 w-4" /> Paste text
            </button>
            <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Upload className="h-4 w-4" />} Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.markdown,.txt"
              className="hidden"
              onChange={(e) => e.target.files && upload(e.target.files)}
            />
          </>
        }
      />

      {index && !index.ready && index.total_chunks > 0 && (
        <div className="mt-6 rounded-lg border border-line bg-panel px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">Building semantic index</span>
            <span className="tabular-nums text-faint">
              {index.embedded_chunks} / {index.total_chunks} passages · <span className="font-mono">{index.model}</span>
            </span>
          </div>
          <div className="mt-2">
            <Progress value={pct} />
          </div>
          <p className="mt-2 text-xs text-faint">Keyword search works already. Meaning-based search turns on as each passage is indexed.</p>
        </div>
      )}

      <div className={dragging ? "mt-6 rounded-lg ring-2 ring-accent ring-offset-4 ring-offset-bg" : "mt-6"}>
        {docs === null ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="Your library is empty"
            body="Drop PDFs, Word documents or Markdown here, or paste text. Start with the student handbook and a pacing guide."
            action={
              <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Upload documents
              </button>
            }
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-2.5 font-medium text-faint">Document</th>
                  <th className="px-4 py-2.5 font-medium text-faint">Passages</th>
                  <th className="px-4 py-2.5 font-medium text-faint">Size</th>
                  <th className="px-4 py-2.5 font-medium text-faint">Added</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {docs.map((d) => {
                  const indexed = d.embedded_count >= d.chunk_count;
                  const canDelete = user?.role === "admin" || d.owner_id === user?.id;
                  return (
                    <tr key={d.id} className="group transition-colors hover:bg-subtle/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-muted">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <a href={`/api/documents/${d.id}/file`} className="block truncate font-medium text-ink hover:underline">
                              {d.title}
                            </a>
                            <div className="truncate text-xs text-faint">{d.filename}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-muted">{d.chunk_count}</span>
                          {indexed ? <Badge tone="success">Indexed</Badge> : <Badge>Indexing</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted">{formatBytes(d.size)}</td>
                      <td className="px-4 py-3 text-muted">
                        {relativeTime(d.created_at)}
                        {d.owner_name && <span className="text-faint"> · {d.owner_name}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canDelete && (
                          <button
                            className="btn-ghost h-7 w-7 px-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                            onClick={() => remove(d)}
                            aria-label={`Remove ${d.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onSaved={() => {
          load();
          refreshStatus();
        }}
      />
    </div>
  );
}

function PasteDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.post("/api/documents/text", { title, text });
      toast({ kind: "success", message: `Added "${title}".` });
      setTitle("");
      setText("");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 animate-fadein" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl bg-panel p-6 shadow-pop animate-fadein">
          <Dialog.Title className="text-lg text-ink">Paste text</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Add a policy, an email from the district, or notes. Markdown headings (#) become citable sections.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Title" htmlFor="paste-title">
              <input id="paste-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Testing accommodations memo" required />
            </Field>
            <Field label="Text" htmlFor="paste-text">
              <textarea
                id="paste-text"
                className="input h-64 resize-y py-2 leading-6"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste here…"
                required
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close className="btn-secondary" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn-primary" disabled={saving || !title.trim() || !text.trim()}>
                {saving && <Spinner />} Add to library
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
