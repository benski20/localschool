import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, Copy, FileDown, ListChecks, User } from "lucide-react";
import { downloadDocx } from "../../../lib/api";
import { Progress, SkeletonText } from "../../ui";
import { DocHeader, MoreMenu } from "../DocHeader";
import { DraftProgress, JobProgress, RetryButton, useDraft } from "../JobProgress";
import { EditableText, SaveHint, useDraftOutput } from "../OutputEditor";
import { Chip, ErrorLine } from "../ToolPage";
import {
  isWorking,
  statusWord,
  tools,
  type BatchProgress,
  type Draft,
  type DraftSummary,
  type FeedbackItem,
  type FeedbackOutput,
} from "../../../lib/tools";

/*
 * Finished feedback, laid out like a document (same language as MeetingDoc): a serif title,
 * chips, then "Strengths" and "Next steps" as quiet outlines. A batch adds a list of pieces
 * on the left; the selected piece reads exactly like a single one.
 */

const BACK = { to: "/tools/feedback", label: "Feedback" };

export function feedbackText(name: string, o: FeedbackOutput): string {
  const block = (title: string, items: FeedbackItem[]) => [title, ...items.map((p) => `- ${p.comment}`)].join("\n");
  return [name, block("Strengths", o.strengths), block("Next steps", o.next_steps)].join("\n\n");
}

const rubricName = (d: Draft<"feedback"> | null | undefined): string => String(d?.input?.rubric?.title ?? "");

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Files that couldn't be read when the feedback was started. */
export type Skipped = { filename: string; error: string }[];

function SkippedLine({ skipped }: { skipped?: Skipped }) {
  if (!skipped?.length) return null;
  return (
    <div className="mt-6">
      <ErrorLine>
        {skipped.length === 1 ? "Skipped " : `Skipped ${skipped.length} files: `}
        {skipped.map((s) => `${s.filename} (${s.error})`).join("; ")}
      </ErrorLine>
    </div>
  );
}

/* ---------- The two outlines ---------- */

/** Rubric lines often arrive as Markdown ("**Voice (4):** …"); show them as plain words. */
const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^\s*(?:[-*+]|#+|\d+[.)])\s+/, "").trim();

function Sections({ output, onChange }: { output: FeedbackOutput; onChange: (o: FeedbackOutput) => void }) {
  const setComment = (key: "strengths" | "next_steps", i: number, comment: string) =>
    onChange({ ...output, [key]: output[key].map((p, j) => (j === i ? { ...p, comment } : p)) });
  return (
    <div className="animate-fade-in space-y-9">
      {(["strengths", "next_steps"] as const).map((key) =>
        output[key].length ? (
          <section key={key}>
            <h2 className="mb-2 text-lg font-medium text-ink">{key === "strengths" ? "Strengths" : "Next steps"}</h2>
            <ul className="space-y-0.5">
              {output[key].map((p, i) => (
                <li
                  key={i}
                  className="group -mx-2 flex items-start gap-2 rounded-md px-2 pb-2.5 transition-colors duration-fast focus-within:bg-ink/[0.03] hover:bg-ink/[0.03]"
                >
                  <span aria-hidden className="flex h-[34px] w-4 shrink-0 items-center justify-center text-faint">
                    <span className="h-[5px] w-[5px] rounded-full bg-current" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <EditableText
                      label={key === "strengths" ? "Strength" : "Next step"}
                      value={p.comment}
                      onChange={(t) => setComment(key, i, t)}
                      className="py-0.5"
                    />
                    {p.quote && <p className="mt-0.5 text-sm italic leading-[22px] text-faint">“{p.quote}”</p>}
                    {p.rubric && (
                      <span
                        className="mt-2 inline-flex h-6 max-w-full items-center rounded-full bg-ink/[0.04] px-2.5 text-xs text-muted"
                        title={plain(p.rubric)}
                      >
                        <span className="truncate">{plain(p.rubric)}</span>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

/* ---------- One piece on its own page ---------- */

export function FeedbackDoc({ id, initial, skipped }: { id: number; initial: Draft<"feedback"> | null; skipped?: Skipped }) {
  const { draft, restart, error } = useDraft<"feedback">(id, initial);
  const { output, setOutput, saved } = useDraftOutput(draft?.status === "ready" ? draft : null);
  const name = draft?.title || "Feedback";
  const text = () => (output ? feedbackText(name, output) : "");
  const ready = draft?.status === "ready" && !!output;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
      <DocHeader
        back={BACK}
        title={error ? "Feedback" : name}
        saved={ready ? saved : undefined}
        copy={ready ? text : undefined}
        word={ready ? { title: `Feedback for ${name}`, text } : undefined}
        chips={draft ? <DocChips student={draft.student?.name} rubric={rubricName(draft)} /> : undefined}
      />
      <SkippedLine skipped={skipped} />
      <div className="mt-10">
        {error ? (
          <p className="text-base text-muted">
            This feedback isn't available.{" "}
            <Link to="/tools/feedback" className="link">
              Start a new one
            </Link>
          </p>
        ) : !draft ? (
          <SkeletonText lines={4} />
        ) : isWorking(draft.status) ? (
          <DraftProgress draft={draft} note="You can leave this page. The feedback will be under Recent." />
        ) : draft.status === "error" ? (
          <PieceError summary={draft} onRetry={restart} />
        ) : output ? (
          <Sections output={output} onChange={setOutput} />
        ) : null}
      </div>
    </div>
  );
}

function DocChips({ student, rubric, children }: { student?: string; rubric?: string; children?: ReactNode }) {
  if (!student && !rubric && !children) return null;
  return (
    <>
      {children}
      {student && (
        <Chip>
          <User className="h-3.5 w-3.5" aria-hidden />
          {student}
        </Chip>
      )}
      {rubric && (
        <Chip className="max-w-full">
          <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{rubric}</span>
        </Chip>
      )}
    </>
  );
}

function PieceError({ summary, onRetry }: { summary: DraftSummary; onRetry: (d: Draft<"feedback">) => void }) {
  return (
    <div className="animate-fade-in space-y-4">
      <p className="text-base text-muted">{summary.error || "Couldn't write feedback for this piece."}</p>
      <RetryButton<Draft<"feedback">> id={summary.id} onRetry={onRetry} />
    </div>
  );
}

/* ---------- A batch: one poll for the whole set ---------- */

function useWide() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

export function BatchDoc({
  batch,
  initial,
  selectedId,
  skipped,
}: {
  batch: string;
  initial: Draft<"feedback">[];
  selectedId?: number | null;
  skipped?: Skipped;
}) {
  const [rows, setRows] = useState<DraftSummary[]>(initial);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [tick, setTick] = useState(0);
  // Full drafts of the finished pieces, and the teacher's latest edits to each.
  const [full, setFull] = useState<Map<number, Draft<"feedback">>>(() => new Map());
  const edits = useRef(new Map<number, FeedbackOutput>());
  const wide = useWide();
  const [picked, setPicked] = useState<number | null>(selectedId ?? null);

  useEffect(() => {
    let alive = true;
    let t = 0;
    const poll = () =>
      tools
        .batch("feedback", batch)
        .then((r) => {
          if (!alive) return;
          setRows(r.drafts);
          setProgress(r.batch);
          if (r.batch && !r.batch.done) t = window.setTimeout(poll, 1500);
        })
        .catch(() => alive && (t = window.setTimeout(poll, 3000)));
    poll();
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [batch, tick]);

  // Load each piece once it's ready (again after a retry).
  const readyIds = rows.filter((r) => r.status === "ready").map((r) => r.id);
  const readyKey = readyIds.join(",");
  useEffect(() => {
    let alive = true;
    for (const pid of readyIds) {
      if (full.get(pid)?.status === "ready") continue;
      tools
        .get<"feedback">(pid)
        .then((d) => alive && setFull((m) => new Map(m).set(pid, d)))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  const onRetry = (d: Draft<"feedback">) => {
    edits.current.delete(d.id);
    setFull((m) => {
      const n = new Map(m);
      n.delete(d.id);
      return n;
    });
    setRows((rs) => rs.map((r) => (r.id === d.id ? d : r)));
    setTick((n) => n + 1);
  };

  const outputOf = (pid: number) => edits.current.get(pid) ?? full.get(pid)?.output ?? null;
  const onEdit = useCallback((pid: number, o: FeedbackOutput) => {
    edits.current.set(pid, o);
  }, []);
  const copyAll = () =>
    rows
      .map((r) => {
        const o = outputOf(r.id);
        return o ? feedbackText(r.title || "Feedback", o) : "";
      })
      .filter(Boolean)
      .join("\n\n");

  const total = progress?.total ?? rows.length;
  const readyCount = progress?.ready ?? readyIds.length;
  const done = progress?.done ?? false;
  const selected = wide ? (rows.find((r) => r.id === picked) ?? rows[0] ?? null) : (rows.find((r) => r.id === picked) ?? null);
  const rubric = rubricName(initial[0] ?? [...full.values()][0]);

  const pane = (r: DraftSummary, row?: ReactNode) => (
    <Piece
      key={r.id}
      row={row}
      summary={r}
      draft={full.get(r.id) ?? null}
      edited={edits.current.get(r.id)}
      onEdit={onEdit}
      onRetry={onRetry}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1104px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
      <div>
        <DocHeader
          back={BACK}
          title={`Feedback for ${total} ${total === 1 ? "piece" : "pieces"}`}
          copy={readyCount > 0 ? copyAll : undefined}
          word={done && readyCount > 0 ? { title: "Feedback", text: copyAll } : undefined}
          chips={
            <>
              <Chip>
                <span
                  aria-hidden
                  className={clsx("h-1.5 w-1.5 rounded-full", done ? "bg-success" : "animate-pulse-soft bg-faint")}
                />
                <span className="tnum">
                  {readyCount} of {total} ready
                </span>
              </Chip>
              <DocChips rubric={rubric} />
            </>
          }
        />
        <SkippedLine skipped={skipped} />
        {!done && (
          <JobProgress
            className="mt-8 max-w-[696px]"
            label={`Writing feedback… ${readyCount} of ${total}`}
            progress={progress?.progress ?? null}
            note="You can leave this page. Each piece will be under Recent."
          />
        )}
      </div>

      {wide ? (
        <div className="mt-10 flex items-start gap-12">
          <nav aria-label="Pieces" className="sticky top-8 w-64 shrink-0">
            <ul className="-mx-3 space-y-0.5">
              {rows.map((r) => (
                <li key={r.id}>
                  <PieceButton summary={r} active={selected?.id === r.id} onClick={() => setPicked(r.id)} />
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 max-w-[696px] flex-1">{selected && pane(selected)}</div>
        </div>
      ) : (
        <ul className="-mx-3 mt-10 space-y-0.5">
          {rows.map((r) => {
            const open = selected?.id === r.id;
            return (
              <li key={r.id}>
                {open ? (
                  pane(r, <PieceButton summary={r} active expandable onClick={() => setPicked(null)} />)
                ) : (
                  <PieceButton summary={r} active={false} expandable onClick={() => setPicked(r.id)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ summary }: { summary: DraftSummary }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "h-2 w-2 shrink-0 rounded-full",
        summary.status === "ready" ? "bg-success" : summary.status === "error" ? "bg-danger" : "animate-pulse-soft bg-faint/60",
      )}
    />
  );
}

function PieceButton({
  summary,
  active,
  expandable,
  onClick,
}: {
  summary: DraftSummary;
  active: boolean;
  expandable?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={!expandable && active ? "true" : undefined}
      aria-expanded={expandable ? active : undefined}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-fast",
        active ? "bg-ink/[0.05] text-ink" : "text-ink/80 hover:bg-ink/[0.03] hover:text-ink",
      )}
    >
      <StatusDot summary={summary} />
      <span className="min-w-0 flex-1 truncate">{summary.title || "Untitled"}</span>
      {summary.status !== "ready" && (
        <span className={clsx("shrink-0 text-xs", summary.status === "error" ? "text-danger" : "text-faint")}>
          {summary.status === "error" ? "Didn't work" : statusWord(summary).replace("…", "")}
        </span>
      )}
      {expandable && (
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-faint transition-transform duration-fast", active && "rotate-180")} aria-hidden />
      )}
    </button>
  );
}

/** The selected piece of a batch: its title with a ⋯ menu, then the same outlines. */
function Piece({
  summary,
  draft,
  edited,
  onEdit,
  onRetry,
  row,
}: {
  summary: DraftSummary;
  draft: Draft<"feedback"> | null;
  edited?: FeedbackOutput;
  onEdit: (id: number, o: FeedbackOutput) => void;
  onRetry: (d: Draft<"feedback">) => void;
  /** On narrow screens the piece's row in the list stands in for its title. */
  row?: ReactNode;
}) {
  const ready = summary.status === "ready";
  // Start from the teacher's unsaved-to-screen edits if they've been here before.
  const start = useMemo(
    () => (ready && draft ? (edited ? { ...draft, output: edited } : draft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, draft],
  );
  const { output, setOutput, saved } = useDraftOutput(start);
  useEffect(() => {
    if (output) onEdit(summary.id, output);
  }, [output, summary.id, onEdit]);

  const name = summary.title || "Feedback";
  const text = () => (output ? feedbackText(name, output) : "");
  const actions = output ? (
    <span className="flex shrink-0 items-center gap-1">
      <SaveHint state={saved} />
      <MoreMenu
        label={`More for ${name}`}
        items={[
          { label: "Copy", icon: <Copy className="h-4 w-4" aria-hidden />, onSelect: () => copyText(text()) },
          {
            label: "Download for Word",
            icon: <FileDown className="h-4 w-4" aria-hidden />,
            onSelect: () => downloadDocx(`Feedback for ${name}`, text()),
          },
        ]}
      />
    </span>
  ) : null;

  const body = isWorking(summary.status) ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-sm text-faint">{statusWord(summary)}</p>
          <Progress value={summary.status === "running" && summary.progress > 0 ? summary.progress * 100 : null} />
        </div>
      ) : summary.status === "error" ? (
        <PieceError summary={summary} onRetry={onRetry} />
      ) : output ? (
        <Sections output={output} onChange={setOutput} />
      ) : (
        <SkeletonText lines={4} />
      );

  if (row)
    return (
      <article>
        <div className="flex items-center gap-1 rounded-lg bg-ink/[0.05] pr-1.5 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:bg-transparent">
          {row}
          {actions}
        </div>
        <div className="animate-slide-down px-3 pb-8 pt-6">{body}</div>
      </article>
    );
  return (
    <article className="animate-fade-in">
      <div className="mb-8 flex min-h-8 items-center justify-between gap-4">
        <h2 className="min-w-0 truncate text-xl font-medium text-ink">{name}</h2>
        {actions}
      </div>
      {body}
    </article>
  );
}
