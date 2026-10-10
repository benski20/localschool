import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Lock, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Source } from "../lib/types";
import { CiteNumber, SourceKindIcon, SourceKindLabel } from "./chat/SourceKind";
import "./chat/chat.css";

interface Passage {
  id: number;
  page: number | null;
  heading: string;
  text: string;
  cited: boolean;
}

const DESKTOP = "(min-width: 768px)";
function useDesktop() {
  const [on, setOn] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const fn = () => setOn(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return on;
}

/**
 * The cited passage in context. Slides in from the right on desktop (pushing the
 * conversation over) and rises as a bottom sheet on phones. Stays mounted while
 * closing so it can animate out.
 */
export function SourcePanel({
  source,
  sources,
  open,
  onSelect,
  onClose,
}: {
  source: Source | null;
  sources: Source[];
  open: boolean;
  onSelect: (n: number) => void;
  onClose: () => void;
}) {
  const desktop = useDesktop();
  // Keep the last source around while the panel animates closed.
  const [shown, setShown] = useState<{ source: Source; sources: Source[] } | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open && source) {
      setShown({ source, sources });
      const r = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(r);
    }
    setVisible(false);
    const t = window.setTimeout(() => setShown(null), 280);
    return () => window.clearTimeout(t);
  }, [open, source, sources]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!shown) return desktop ? <div className="chat-panel-shell w-0 shrink-0" aria-hidden /> : null;

  const body = <PanelBody source={shown.source} sources={shown.sources} onSelect={onSelect} onClose={onClose} sheet={!desktop} />;

  if (desktop) {
    return (
      <div className={clsx("chat-panel-shell relative h-full shrink-0 overflow-hidden", visible ? "w-[420px] lg:w-[440px]" : "w-0")}>
        <aside
          aria-label="Source"
          className={clsx(
            "chat-panel-inner absolute inset-y-0 right-0 flex w-[420px] flex-col border-l border-line bg-bg lg:w-[440px]",
            visible ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0",
          )}
        >
          {body}
        </aside>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Source">
      <div className={clsx("chat-backdrop absolute inset-0 bg-black/40", visible ? "opacity-100" : "opacity-0")} onClick={onClose} aria-hidden />
      <aside
        className={clsx(
          "chat-sheet absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-[4px] border-t border-line bg-bg",
          visible ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex justify-center pb-1 pt-2.5" aria-hidden>
          <span className="h-1 w-9 bg-line-strong" />
        </div>
        {body}
      </aside>
    </div>
  );
}

function PanelBody({
  source,
  sources,
  onSelect,
  onClose,
  sheet,
}: {
  source: Source;
  sources: Source[];
  onSelect: (n: number) => void;
  onClose: () => void;
  sheet: boolean;
}) {
  const idx = sources.findIndex((s) => s.n === source.n);
  const prev = idx > 0 ? sources[idx - 1] : null;
  const next = idx >= 0 && idx < sources.length - 1 ? sources[idx + 1] : null;
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sheet) closeBtn.current?.focus({ preventScroll: true });
  }, [sheet]);

  return (
    <>
      <header className={clsx("flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-4 md:px-5", sheet ? "h-12" : "h-14")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">Source</span>
          <span className="font-mono text-[12px] tabular-nums text-accent">{String(source.n).padStart(2, "0")}</span>
          {sources.length > 1 && (
            <span className="font-mono text-[11.5px] tabular-nums text-faint">
              · {idx + 1}/{sources.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {sources.length > 1 && (
            <>
              <button className="btn-ghost h-8 w-8 px-0" disabled={!prev} onClick={() => prev && onSelect(prev.n)} aria-label="Previous source">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button className="btn-ghost h-8 w-8 px-0" disabled={!next} onClick={() => next && onSelect(next.n)} aria-label="Next source">
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            </>
          )}
          <button ref={closeBtn} className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close source panel">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div key={`${source.n}-${source.chunk_id ?? source.student_id ?? source.title}`} className="chat-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-6 md:px-6">
        <SourceKindLabel kind={source.kind} />
        <h2 className="mt-2.5 text-[20px] font-normal leading-[1.35] tracking-[-0.012em] text-ink">{source.title}</h2>
        {source.subtitle && <p className="mt-1 text-[13.5px] text-muted">{source.subtitle}</p>}

        <div className="mt-5">{source.kind === "student" ? <StudentRecord source={source} /> : <DocumentPassages source={source} />}</div>
      </div>

      {sources.length > 1 && (
        <footer className="shrink-0 border-t border-line bg-subtle/50 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="mb-1.5 px-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">All sources in this answer</div>
          <ul className="max-h-[152px] space-y-0.5 overflow-y-auto">
            {sources.map((s) => (
              <li key={s.n}>
                <button
                  onClick={() => onSelect(s.n)}
                  aria-current={s.n === source.n || undefined}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-[2px] px-1.5 py-1.5 text-left transition-colors",
                    s.n === source.n ? "bg-panel shadow-[inset_0_0_0_1px_rgb(var(--border))]" : "hover:bg-panel/70",
                  )}
                >
                  <CiteNumber n={s.n} active={s.n === source.n} />
                  <SourceKindIcon kind={s.kind} className="h-5 w-5 border-0" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.title}</span>
                  {s.subtitle && <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-faint sm:inline">{s.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </>
  );
}

function DocumentPassages({ source }: { source: Source }) {
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [error, setError] = useState("");
  const cited = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPassages(null);
    setError("");
    if (!source.document_id || !source.chunk_id) return;
    let live = true;
    api
      .get<{ passages: Passage[] }>(`/api/documents/${source.document_id}/chunks/${source.chunk_id}`)
      .then((r) => live && setPassages(r.passages))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    if (passages) cited.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [passages]);

  const noFile = !source.document_id || !source.chunk_id;

  return (
    <>
      {noFile ? (
        <Highlighted label={source.subtitle}>{source.text}</Highlighted>
      ) : error ? (
        <div className="border border-danger/30 bg-panel px-3.5 py-3 text-sm text-danger">{error}</div>
      ) : !passages ? (
        <div className="space-y-2.5" aria-label="Loading passage">
          <div className="chat-line h-3 w-24" />
          <div className="chat-line h-3 w-full" />
          <div className="chat-line h-3 w-11/12" />
          <div className="chat-line h-3 w-4/5" />
        </div>
      ) : (
        <div className="space-y-3">
          {passages.map((p) =>
            p.cited ? (
              <div ref={cited} key={p.id}>
                <Highlighted label={[p.page ? `Page ${p.page}` : "", p.heading].filter(Boolean).join(" · ")}>{p.text}</Highlighted>
              </div>
            ) : (
              <p key={p.id} className="whitespace-pre-wrap px-1 text-[13px] leading-[21px] text-faint">
                {p.text}
              </p>
            ),
          )}
        </div>
      )}

      {source.document_id && (
        <a className="btn-secondary mt-5 h-9 w-full rounded-[2px]" href={`/api/documents/${source.document_id}/file`}>
          <ExternalLink className="h-3.5 w-3.5" /> Open original document
        </a>
      )}
    </>
  );
}

function Highlighted({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <figure className="chat-highlight relative border border-accent/25 bg-accent-soft px-4 py-3.5">
      <span className="absolute -left-px -top-px bottom-[-1px] w-[2px] bg-accent" aria-hidden />
      <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-accent">
        Cited passage{label ? <span className="normal-case tracking-normal text-accent/80">· {label}</span> : null}
      </figcaption>
      <blockquote className="whitespace-pre-wrap text-[14px] leading-[23px] text-ink">{children}</blockquote>
    </figure>
  );
}

function StudentRecord({ source }: { source: Source }) {
  const rows = source.text
    .split("\n")
    .map((line) => {
      const at = line.indexOf(": ");
      return at < 0 ? { k: "", v: line } : { k: line.slice(0, at), v: line.slice(at + 2) };
    })
    .filter((r) => r.v);

  return (
    <>
      <div className="mb-3 flex items-start gap-2 border border-line bg-panel px-3 py-2.5 text-[12.5px] leading-[18px] text-muted">
        <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warning" />
        <span>Confidential student information from your class roster.</span>
      </div>
      <dl className="border border-line bg-panel">
        {rows.map((r, i) => (
          <div key={i} className={clsx("grid grid-cols-[minmax(108px,38%)_1fr] gap-3 px-3.5 py-2.5 text-[13px] leading-[20px]", i > 0 && "border-t border-line")}>
            <dt className="text-[11px] uppercase leading-[20px] tracking-[0.06em] text-faint">{r.k}</dt>
            <dd className="min-w-0 text-ink">
              {/^accommodations$/i.test(r.k) && r.v.includes(";") ? (
                <ul className="flex flex-wrap gap-1">
                  {r.v.split(/;\s*/).filter(Boolean).map((a) => (
                    <li key={a} className="rounded-[2px] border border-line px-1.5 py-0.5 text-[12px]">
                      {a}
                    </li>
                  ))}
                </ul>
              ) : (
                r.v
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
