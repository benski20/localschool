import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ClipboardPaste, CloudUpload, SearchX, Trash2, Upload } from "lucide-react";
import { api, formatBytes, relativeTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { DocumentRow } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton, Spinner } from "../components/ui";
import {
  Bar,
  Callout,
  ConfirmDialog,
  DetailList,
  Frame,
  Label,
  Modal,
  ModalFooter,
  RailSection,
  SearchField,
  Sheet,
  StatusText,
  Steps,
  Tabs,
  WorkspaceHeader,
  WorkspacePage,
  dangerQuiet,
  linkClass,
  useKeyShortcut,
} from "../components/workspace/primitives";
import { FileTile, KIND_LABEL, fileKind } from "../components/workspace/fileType";

interface IndexInfo {
  model: string;
  total_chunks: number;
  embedded_chunks: number;
  ready: boolean;
}

type StatusFilter = "all" | "ready" | "indexing";
type Sort = "recent" | "name" | "size";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const COLS = "md:grid-cols-[minmax(0,1fr)_112px_64px_72px_96px_28px] md:gap-3";

export function Library() {
  const { user } = useAuth();
  const toast = useToast();
  const { refresh: refreshStatus } = useStatus();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [index, setIndex] = useState<IndexInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<{ name: string; size: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<DocumentRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
    setPending(list.map((f) => ({ name: f.name, size: f.size })));
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
      setPending([]);
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

  // Whole-window drop target while this page is open.
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) uploadRef.current(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  useKeyShortcut("/", useCallback(() => searchRef.current?.focus(), []));
  useKeyShortcut("u", useCallback(() => fileInput.current?.click(), []));

  const pct = index && index.total_chunks ? Math.round((100 * index.embedded_chunks) / index.total_chunks) : 100;
  const isReady = (d: DocumentRow) => d.embedded_count >= d.chunk_count;

  const counts = useMemo(() => {
    const all = docs ?? [];
    return { all: all.length, ready: all.filter(isReady).length, indexing: all.filter((d) => !isReady(d)).length };
  }, [docs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (docs ?? []).filter(
      (d) =>
        (statusFilter === "all" || (statusFilter === "ready" ? isReady(d) : !isReady(d))) &&
        (!q || d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q) || (d.owner_name ?? "").toLowerCase().includes(q)),
    );
    const sorted = [...rows];
    if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "size") sorted.sort((a, b) => b.size - a.size);
    return sorted;
  }, [docs, query, statusFilter, sort]);

  const totals = useMemo(() => {
    const all = docs ?? [];
    return { passages: all.reduce((n, d) => n + d.chunk_count, 0), bytes: all.reduce((n, d) => n + d.size, 0) };
  }, [docs]);

  const openDoc = docs?.find((d) => d.id === openId) ?? null;
  const canDelete = (d: DocumentRow) => user?.role === "admin" || d.owner_id === user?.id;
  const browse = () => fileInput.current?.click();
  const empty = docs !== null && docs.length === 0 && pending.length === 0;

  const rail = (
    <>
      {index && index.total_chunks > 0 && (
        <RailSection label="Semantic index">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[28px] leading-9 tracking-tight text-ink">{pct}%</span>
            <StatusText tone={index.ready ? "success" : "warning"}>{index.ready ? "Ready" : "Processing"}</StatusText>
          </div>
          <Bar value={pct} tone={index.ready ? "success" : "ink"} className="mt-2" />
          <p className="mt-2 text-[13px] text-muted">
            <span className="font-mono text-ink">{index.embedded_chunks.toLocaleString()}</span> of{" "}
            <span className="font-mono text-ink">{index.total_chunks.toLocaleString()}</span> passages
            <span className="text-faint"> · </span>
            <span className="font-mono text-[12px] text-faint">{index.model}</span>
          </p>
          {!index.ready && <p className="mt-1 text-[13px] leading-5 text-faint">Keyword search already works. Meaning-based search turns on as each passage is indexed.</p>}
        </RailSection>
      )}

      {docs && docs.length > 0 && (
        <RailSection label="Library">
          <DetailList
            items={[
              { label: "Documents", value: docs.length, mono: true },
              { label: "Citable passages", value: totals.passages.toLocaleString(), mono: true },
              { label: "Storage", value: formatBytes(totals.bytes), mono: true },
            ]}
          />
        </RailSection>
      )}

      <RailSection label="Add documents">
        <button
          type="button"
          data-dropzone
          onClick={browse}
          className="group flex w-full flex-col items-center justify-center border border-dashed border-line-strong bg-panel px-4 py-6 text-center transition-colors duration-150 hover:border-ink/40"
        >
          <CloudUpload className="h-5 w-5 text-faint transition-colors group-hover:text-ink" strokeWidth={1.5} aria-hidden />
          <span className="mt-2 text-sm text-ink">Drop files or browse</span>
          <span className="mt-0.5 text-xs text-faint">PDF · Word · Markdown · Text</span>
        </button>
        <button type="button" className={`${linkClass} mt-3`} onClick={() => setPasteOpen(true)}>
          Or paste text
        </button>
      </RailSection>

      <RailSection label="What happens">
        <Steps
          items={[
            { title: "Upload", body: "Files stay on your school's server. Nothing is sent to an outside service." },
            { title: "Split", body: "Each document is broken into short, citable passages by heading and page." },
            { title: "Index", body: "Passages are indexed for meaning, so plain-language questions find them." },
            { title: "Cite", body: "Answers link to the exact passage, so anyone can check the source." },
          ]}
        />
      </RailSection>
    </>
  );

  return (
    <WorkspacePage>
      <WorkspaceHeader
        title="Library"
        description="Policies, handbooks and curriculum the assistant searches and cites."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="h-4 w-4" aria-hidden /> Paste text
            </button>
            <button className="btn-primary" onClick={browse} disabled={uploading}>
              {uploading ? <Spinner /> : <Upload className="h-4 w-4" aria-hidden />} Upload
            </button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          </>
        }
      />

      <Frame className="mt-8" rail={rail} railWidth={300}>
        <div className="px-5 pt-6 sm:px-6">
          <Label className="mb-1.5">All documents</Label>
          <h2 className="text-[19px] font-normal leading-7 text-ink">{empty ? "Nothing here yet" : "Everything the assistant can cite"}</h2>
        </div>

        {docs === null ? (
          <div className="mt-6 divide-y divide-line border-t border-line">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-3.5">
                <Skeleton className="h-9 w-[30px] rounded-[2px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/5 rounded-[2px]" />
                  <Skeleton className="h-3 w-1/4 rounded-[2px]" />
                </div>
                <Skeleton className="hidden h-3 w-16 rounded-[2px] sm:block" />
              </div>
            ))}
          </div>
        ) : empty ? (
          <EmptyLibrary onBrowse={browse} onPaste={() => setPasteOpen(true)} />
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-3 border-b border-line px-5 sm:px-6 md:flex-row md:items-end md:justify-between">
              <Tabs
                label="Filter by status"
                value={statusFilter}
                onChange={setStatusFilter}
                items={[
                  { id: "all", label: "All", count: counts.all },
                  { id: "ready", label: "Indexed", count: counts.ready },
                  { id: "indexing", label: "Processing", count: counts.indexing },
                ]}
              />
              <div className="flex items-center gap-2 pb-3">
                <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search documents" label="Search documents" className="min-w-0 flex-1 md:w-56 md:flex-none" />
                <label className="sr-only" htmlFor="lib-sort">
                  Sort
                </label>
                <select id="lib-sort" className="input h-8 w-auto shrink-0 pr-8 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recent">Recent</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
              </div>
            </div>

            <div className={`hidden items-center gap-4 border-b border-line px-6 py-2 text-xs text-faint md:grid ${COLS}`}>
              <span>Document</span>
              <span>Status</span>
              <span className="text-right">Passages</span>
              <span className="text-right">Size</span>
              <span>Added</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul className="ws-stagger divide-y divide-line">
              {pending.map((p, i) => (
                <li key={`p-${p.name}-${i}`} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-6 md:gap-4 ${COLS}`} style={{ ["--i" as string]: i }}>
                  <div className="flex min-w-0 items-center gap-3">
                    <FileTile kind={fileKind(p.name)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{p.name}</div>
                      <Bar value={null} className="mt-2 max-w-[200px]" />
                    </div>
                  </div>
                  <StatusText tone="neutral">
                    <Spinner className="h-3 w-3" /> Uploading
                  </StatusText>
                  <span className="hidden text-right font-mono text-[13px] text-faint md:block">—</span>
                  <span className="hidden text-right font-mono text-[13px] text-muted md:block">{formatBytes(p.size)}</span>
                  <span className="hidden text-sm text-faint md:block">now</span>
                  <span className="hidden md:block" />
                </li>
              ))}
              {visible.map((d, i) => (
                <DocRow key={d.id} d={d} i={i + pending.length} onOpen={() => setOpenId(d.id)} onDelete={canDelete(d) ? () => setConfirm(d) : undefined} />
              ))}
            </ul>
            {visible.length === 0 && pending.length === 0 && (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <SearchX className="h-5 w-5 text-faint" strokeWidth={1.5} aria-hidden />
                <p className="mt-2 text-sm text-ink">No documents match</p>
                <button
                  className={`${linkClass} mt-1`}
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            <div className="border-t border-line px-6 py-3 text-xs text-faint">
              <span className="font-mono">{visible.length}</span> of <span className="font-mono">{counts.all}</span> documents
              <span className="hidden md:inline">
                {" "}· <span className="kbd">/</span> search · <span className="kbd">U</span> upload
              </span>
            </div>
          </>
        )}
      </Frame>

      {dragging && <DropOverlay />}

      <DocSheet doc={openDoc} onClose={() => setOpenId(null)} onDelete={openDoc && canDelete(openDoc) ? () => setConfirm(openDoc) : undefined} />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        kicker="Delete document"
        title={`Delete “${confirm?.title ?? ""}”?`}
        body={<>The file and its {confirm?.chunk_count ?? 0} passages leave the library, and the assistant stops citing it. You'll have a few seconds to undo.</>}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirm) remove(confirm);
          setConfirm(null);
          setOpenId(null);
        }}
      />

      <PasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onSaved={() => {
          load();
          refreshStatus();
        }}
      />
    </WorkspacePage>
  );
}

/* ------------------------------------------------------------------ Row */

function docPct(d: DocumentRow) {
  return d.chunk_count ? Math.round((100 * d.embedded_count) / d.chunk_count) : 100;
}

function DocStatus({ d }: { d: DocumentRow }) {
  if (d.status === "error" || d.error) return <StatusText tone="danger">Failed</StatusText>;
  if (d.embedded_count >= d.chunk_count) return <StatusText tone="success">Indexed</StatusText>;
  return (
    <StatusText tone="warning" title={`${d.embedded_count} of ${d.chunk_count} passages indexed`}>
      Processing <span className="font-mono tracking-normal">{docPct(d)}%</span>
    </StatusText>
  );
}

function DocRow({ d, i, onOpen, onDelete }: { d: DocumentRow; i: number; onOpen: () => void; onDelete?: () => void }) {
  const kind = fileKind(d.filename, d.mime);
  return (
    <li
      data-doc-row
      style={{ ["--i" as string]: i }}
      className={`group relative grid cursor-pointer grid-cols-1 items-center gap-3 px-5 py-3 transition-colors duration-100 hover:bg-bg sm:px-6 md:gap-4 ${COLS}`}
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileTile kind={kind} />
        <div className="min-w-0">
          <button
            type="button"
            className="block max-w-full truncate text-left text-sm text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {d.title}
          </button>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-faint">
            <span className="hidden truncate md:inline">{d.filename}</span>
            <span className="flex min-w-0 items-center gap-1.5 md:hidden">
              <DocStatus d={d} />
              <span className="truncate">
                · <span className="font-mono">{d.chunk_count}</span> passages · <span className="font-mono">{formatBytes(d.size)}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="hidden md:block">
        <DocStatus d={d} />
      </div>
      <span className="hidden text-right font-mono text-[13px] text-muted md:block">{d.chunk_count.toLocaleString()}</span>
      <span className="hidden text-right font-mono text-[13px] text-muted md:block">{formatBytes(d.size)}</span>
      <span className="hidden min-w-0 truncate text-[13px] text-muted md:block" title={d.owner_name ? `Added by ${d.owner_name}` : undefined}>
        {relativeTime(d.created_at)}
      </span>
      <span className="relative z-10 hidden justify-end md:flex">
        {onDelete && (
          <button
            className="btn-ghost h-7 w-7 px-0 opacity-0 transition-opacity duration-100 hover:text-danger focus:opacity-100 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${d.title}`}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ Detail */

function parseTs(ts: string) {
  return new Date(ts.includes("T") || ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z");
}

function DocSheet({ doc, onClose, onDelete }: { doc: DocumentRow | null; onClose: () => void; onDelete?: () => void }) {
  // Keep the last doc rendered while the sheet animates closed.
  const [last, setLast] = useState<DocumentRow | null>(doc);
  useEffect(() => {
    if (doc) setLast(doc);
  }, [doc]);
  const d = doc ?? last;
  if (!d) return null;
  const kind = fileKind(d.filename, d.mime);
  const p = docPct(d);
  const ready = d.embedded_count >= d.chunk_count;
  const failed = d.status === "error" || !!d.error;

  return (
    <Sheet
      open={!!doc}
      onOpenChange={(o) => !o && onClose()}
      title={d.title}
      description={<span className="font-mono text-[12px] text-faint">{d.filename}</span>}
      header={
        <div className="mb-4 flex items-center justify-between">
          <FileTile kind={kind} size="lg" />
          <DocStatus d={d} />
        </div>
      }
      footer={
        <>
          <a className="btn-secondary" href={`/api/documents/${d.id}/file`}>
            <ArrowUpRight className="h-4 w-4" aria-hidden /> Open original
          </a>
          {onDelete && (
            <button className={`${dangerQuiet} ml-auto`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Delete
            </button>
          )}
        </>
      }
    >
      <div className="space-y-8">
        {failed && (
          <Callout tone="danger" title="Couldn't read this file">
            {d.error || "Try re-uploading it, or paste its text instead."}
          </Callout>
        )}

        <section>
          <Label as="h3" className="mb-3">
            Search readiness
          </Label>
          <DetailList
            items={[
              { label: "Keyword search", value: <StatusText tone="success">Ready</StatusText> },
              {
                label: "Meaning-based search",
                value: ready ? <StatusText tone="success">Ready</StatusText> : <StatusText tone="warning">Processing</StatusText>,
              },
            ]}
          />
          <Bar value={p} tone={ready ? "success" : "ink"} className="mt-4" />
          <p className="mt-2 text-[13px] text-muted">
            <span className="font-mono text-ink">{d.embedded_count.toLocaleString()}</span> of <span className="font-mono text-ink">{d.chunk_count.toLocaleString()}</span> passages indexed
          </p>
        </section>

        <section>
          <Label as="h3" className="mb-3">
            Details
          </Label>
          <DetailList
            items={[
              { label: "Type", value: KIND_LABEL[kind] },
              { label: "Size", value: formatBytes(d.size), mono: true },
              ...(d.pages ? [{ label: "Pages", value: d.pages.toLocaleString(), mono: true }] : []),
              { label: "Passages", value: d.chunk_count.toLocaleString(), mono: true },
              {
                label: "Added",
                value: (
                  <span>
                    {parseTs(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    <span className="text-faint"> · {relativeTime(d.created_at)}</span>
                  </span>
                ),
              },
              { label: "Added by", value: d.owner_name ?? "School library" },
            ]}
          />
        </section>

        <p className="text-[13px] leading-5 text-faint">Answers that use this document cite the exact passage, so teachers can open the source and check it.</p>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Empty + drop */

function EmptyLibrary({ onBrowse, onPaste }: { onBrowse: () => void; onPaste: () => void }) {
  return (
    <div className="px-5 pb-8 pt-5 sm:px-6">
      <div data-dropzone className="flex flex-col items-center border border-dashed border-line-strong px-6 py-14 text-center">
        <div className="flex gap-1.5" aria-hidden>
          <FileTile kind="pdf" size="lg" />
          <FileTile kind="word" size="lg" />
          <FileTile kind="markdown" size="lg" />
        </div>
        <p className="mt-5 max-w-sm text-[15px] leading-6 text-muted">
          Drop PDFs, Word documents or Markdown anywhere on this page. Start with the student handbook and a pacing guide.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={onBrowse}>
            <Upload className="h-4 w-4" aria-hidden /> Upload documents
          </button>
          <button className="btn-secondary" onClick={onPaste}>
            <ClipboardPaste className="h-4 w-4" aria-hidden /> Paste text
          </button>
        </div>
      </div>
      <Label className="mb-2 mt-8">Good first documents</Label>
      <div className="flex flex-wrap gap-2">
        {["Student & family handbook", "Pacing guides", "Testing accommodations policy", "District memos"].map((s) => (
          <span key={s} className="border border-line px-3 py-1.5 text-[13px] text-muted">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="ws-overlay pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 sm:p-8">
      <div className="flex h-full max-h-[400px] w-full max-w-[600px] flex-col items-center justify-center border-2 border-dashed border-ink/50 bg-panel text-center">
        <CloudUpload className="h-7 w-7 text-ink" strokeWidth={1.5} aria-hidden />
        <div className="mt-4 text-[22px] font-normal text-ink">Drop to add to the library</div>
        <p className="mt-1 text-sm text-muted">PDF, Word, Markdown or plain text. Searchable as soon as it lands.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Paste */

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

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sections = (text.match(/^#{1,6}\s+\S/gm) ?? []).length;
  const canSave = !saving && !!title.trim() && !!text.trim();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={680}
      label="Add to library"
      title="Paste text"
      description="A policy, an email from the district, or notes. Markdown headings (#) become citable sections."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSave) save();
          }
        }}
      >
        <div className="space-y-4 px-6 pb-6 pt-4">
          <div>
            <label htmlFor="paste-title" className="mb-1.5 block text-sm font-medium text-ink">
              Title
            </label>
            <input id="paste-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Testing accommodations memo" required autoFocus />
          </div>
          <div>
            <label htmlFor="paste-text" className="mb-1.5 block text-sm font-medium text-ink">
              Text
            </label>
            <textarea
              id="paste-text"
              className="input block h-64 resize-y bg-bg py-2.5 text-sm leading-6 sm:h-72"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Paste here…\n\n# Section headings like this become citable sections"}
              required
            />
            <div className="mt-1.5 flex items-center gap-3 text-xs text-faint">
              <span>
                <span className="font-mono">{words.toLocaleString()}</span> words
              </span>
              <span>
                <span className="font-mono">{sections}</span> {sections === 1 ? "section" : "sections"}
              </span>
              <span className="ml-auto">
                <span className="font-mono">{text.length.toLocaleString()}</span> characters
              </span>
            </div>
          </div>
        </div>
        <ModalFooter
          hint={
            <span className="flex items-center gap-1">
              <span className="kbd">⌘</span>
              <span className="kbd">↵</span> to add
            </span>
          }
        >
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!canSave}>
            {saving && <Spinner />} Add to library
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
