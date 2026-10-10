import { useEffect, useState } from "react";
import { Download, FileText, UserRound, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Source } from "../lib/types";
import { Skeleton } from "./ui";

interface Passage {
  id: number;
  page: number | null;
  heading: string;
  text: string;
  cited: boolean;
}

/** Right-hand panel: the cited passage in context, highlighted. */
export function SourcePanel({ source, sources, onSelect, onClose }: { source: Source; sources: Source[]; onSelect: (n: number) => void; onClose: () => void }) {
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPassages(null);
    setError("");
    if (source.kind !== "document" || !source.document_id || !source.chunk_id) return;
    api
      .get<{ passages: Passage[] }>(`/api/documents/${source.document_id}/chunks/${source.chunk_id}`)
      .then((r) => setPassages(r.passages))
      .catch((e) => setError(e.message));
  }, [source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="fixed inset-0 z-30 flex h-full w-full shrink-0 flex-col border-l border-line bg-panel animate-fadein md:static md:z-auto md:w-[400px]" aria-label="Source">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent px-1 text-[11px] font-semibold text-accent-fg">{source.n}</span>
          <span className="eyebrow">{source.kind === "document" ? "Document" : "Roster record"}</span>
        </div>
        <button className="btn-ghost h-7 w-7 px-0" onClick={onClose} aria-label="Close source panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-muted">
            {source.kind === "document" ? <FileText className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{source.title}</h2>
            {source.subtitle && <p className="text-sm text-muted">{source.subtitle}</p>}
          </div>
        </div>

        <div className="mt-5">
          {source.kind === "student" ? (
            <dl className="divide-y divide-line rounded-lg border border-line">
              {source.text.split("\n").map((line, i) => {
                const [k, ...v] = line.split(": ");
                return (
                  <div key={i} className="grid grid-cols-[132px_1fr] gap-3 px-3.5 py-2.5 text-sm">
                    <dt className="text-faint">{k}</dt>
                    <dd className="text-ink">{v.join(": ")}</dd>
                  </div>
                );
              })}
            </dl>
          ) : error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !passages ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : (
            <div className="space-y-4 text-sm leading-6">
              {passages.map((p) => (
                <div
                  key={p.id}
                  className={clsx(
                    "whitespace-pre-wrap rounded-md",
                    p.cited ? "border-l-2 border-accent bg-accent-soft/60 px-3.5 py-3 text-ink" : "px-1 text-faint",
                  )}
                >
                  {p.cited && (p.heading || p.page) && (
                    <div className="mb-1.5 text-xs font-medium text-accent">
                      {[p.page ? `Page ${p.page}` : "", p.heading].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {p.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {source.kind === "document" && source.document_id && (
          <a className="btn-secondary mt-5" href={`/api/documents/${source.document_id}/file`}>
            <Download className="h-4 w-4" /> Open original
          </a>
        )}
      </div>

      {sources.length > 1 && (
        <div className="border-t border-line px-4 py-3">
          <div className="eyebrow mb-2">All sources in this answer</div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <button
                key={s.n}
                onClick={() => onSelect(s.n)}
                className={clsx(
                  "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                  s.n === source.n ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                <span className="font-semibold tabular-nums">{s.n}</span>
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
