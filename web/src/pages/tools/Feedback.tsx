import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { FileText, X } from "lucide-react";
import { api, formatBytes } from "../../lib/api";
import type { DocumentRow } from "../../lib/types";
import { Progress } from "../../components/ui";
import { ToolPage, Narrow, Labelled, ErrorLine, Reveal } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { JobProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, OutputEditor, SaveHint, WordButton, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import {
  isWorking,
  statusWord,
  toForm,
  tools,
  type BatchProgress,
  type Draft,
  type DraftSummary,
  type FeedbackCreate,
  type FeedbackItem,
  type FeedbackOutput,
} from "../../lib/tools";

const PASTE = "paste";
const UPLOAD = "upload";
const ACCEPT = ".txt,.md,.pdf,.docx";

export function Feedback() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"feedback"> } | null)?.draft ?? null;

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [rubric, setRubric] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [focus, setFocus] = useState("");
  const [studentId, setStudentId] = useState<number | null>(null);
  const [batch, setBatch] = useState<{ id: string; drafts: Draft<"feedback">[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [skipped, setSkipped] = useState<{ filename: string; error: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const rubricPicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ documents: DocumentRow[] }>("/api/documents")
      .then((r) => {
        const usable = r.documents.filter((d) => d.chunk_count > 0);
        // Rubrics first: they're what a teacher is looking for here.
        usable.sort((a, b) => Number(/rubric/i.test(b.title)) - Number(/rubric/i.test(a.title)));
        setDocs(usable);
        if (!usable.length) setRubric((r) => r || PASTE);
      })
      .catch(() => {
        setDocs([]);
        setRubric((r) => r || PASTE);
      });
  }, []);

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []); // copy now: clearing the input empties the live FileList
    if (picked.length) setFiles((fs) => [...fs, ...picked]);
  };
  const pieces = files.length + (text.trim() ? 1 : 0);
  const hasRubric = rubric === PASTE ? !!rubricText.trim() : rubric === UPLOAD ? !!rubricFile : !!rubric;

  const submit = async () => {
    setBusy(true);
    setFailure("");
    setSkipped([]);
    const fields: FeedbackCreate = {
      work: text.trim() || undefined,
      rubric_document_id: rubric && rubric !== PASTE && rubric !== UPLOAD ? Number(rubric) : undefined,
      rubric_text: rubric === PASTE ? rubricText.trim() : undefined,
      focus: focus.trim() || undefined,
      student_id: studentId,
    };
    try {
      let body: FeedbackCreate | FormData = fields;
      if (files.length || rubric === UPLOAD) {
        const fd = toForm({ ...fields }, files);
        if (rubric === UPLOAD && rubricFile) fd.append("rubric_file", rubricFile, rubricFile.name);
        body = fd;
      }
      const res = await tools.create("feedback", body);
      setFiles([]);
      setText("");
      setSkipped(res.errors);
      if (res.batch) {
        setBatch({ id: res.batch, drafts: res.drafts });
        if (id !== null) navigate("/tools/feedback");
      } else {
        setBatch(null);
        navigate(`/tools/feedback/${res.draft.id}`, { state: { draft: res.draft } });
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolPage title="Feedback">
      <Narrow className="space-y-8">
        <Labelled label="Student work" htmlFor="fb-work">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            className={clsx("rounded transition-shadow duration-fast", drag && "shadow-focus")}
          >
            <textarea
              id="fb-work"
              className="input"
              rows={6}
              placeholder="Paste student work, or drop files here"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded border border-line bg-panel">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex animate-fade-in items-center gap-3 py-2 pl-3 pr-1.5 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                  <span className="tnum shrink-0 text-xs text-faint">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="btn-ghost btn-icon btn-sm text-faint"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-link mt-3 font-normal" onClick={() => picker.current?.click()}>
            {files.length ? "Add more files" : "Choose files"}
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            data-testid="work-files"
            accept={ACCEPT}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </Labelled>

        <Labelled label="Rubric" htmlFor="fb-rubric">
          <select
            id="fb-rubric"
            className="input"
            value={rubric}
            disabled={docs === null}
            onChange={(e) => {
              setRubric(e.target.value);
              if (e.target.value === UPLOAD && !rubricFile) rubricPicker.current?.click();
            }}
          >
            {rubric === "" && (
              <option value="" disabled>
                Choose a rubric
              </option>
            )}
            {docs && docs.length > 0 && (
              <optgroup label="Documents">
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title || d.filename}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={PASTE}>Paste a rubric</option>
            <option value={UPLOAD}>Upload a rubric</option>
          </select>
          {rubric === PASTE && (
            <textarea
              className="input mt-3 animate-fade-in"
              rows={4}
              aria-label="Rubric text"
              placeholder="Paste the rubric here, one criterion per line"
              value={rubricText}
              onChange={(e) => setRubricText(e.target.value)}
            />
          )}
          {rubric === UPLOAD && rubricFile && (
            <div className="mt-3 flex animate-fade-in items-center gap-3 rounded border border-line bg-panel py-2 pl-3 pr-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{rubricFile.name}</span>
              <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label="Remove rubric file" onClick={() => setRubricFile(null)}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
          {rubric === UPLOAD && !rubricFile && (
            <button type="button" className="btn-link mt-3 font-normal" onClick={() => rubricPicker.current?.click()}>
              Choose a file
            </button>
          )}
          <input
            ref={rubricPicker}
            type="file"
            hidden
            accept={ACCEPT}
            onChange={(e) => {
              setRubricFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </Labelled>

        <div className="grid gap-8 sm:grid-cols-2 sm:gap-5">
          <Labelled label="Focus" optional htmlFor="fb-focus">
            <input id="fb-focus" className="input" placeholder="e.g. use of evidence" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Labelled>
          <Labelled label="Student" optional htmlFor="fb-student">
            <StudentPicker id="fb-student" value={studentId} onChange={setStudentId} />
          </Labelled>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" className="btn-primary btn-lg" disabled={!pieces || !hasRubric || busy} onClick={submit}>
            {busy ? "Starting…" : pieces > 1 ? `Draft feedback for ${pieces}` : "Draft feedback"}
          </button>
          <span className="text-sm text-faint">Drafts only. No grades.</span>
        </div>
        {failure && <ErrorLine>{failure}</ErrorLine>}
        {skipped.length > 0 && (
          <ErrorLine>
            {skipped.length === 1 ? "Skipped " : `Skipped ${skipped.length} files: `}
            {skipped.map((s) => `${s.filename} (${s.error})`).join("; ")}
          </ErrorLine>
        )}
      </Narrow>

      <Reveal id={batch?.id ?? id}>
      {batch && (id === null || batch.drafts.some((d) => d.id === id)) ? (
        <Narrow>
          <BatchView batch={batch.id} initial={batch.drafts} />
        </Narrow>
      ) : id !== null ? (
        <Narrow>
          <OutputEditor label="Feedback">
            <ol className="border-t border-line">
              <SinglePiece id={id} initial={initial?.id === id ? initial : null} />
            </ol>
          </OutputEditor>
        </Narrow>
      ) : null}
      </Reveal>

      <Narrow>
        <DraftList tool="feedback" activeId={id} refreshKey={batch?.id} />
      </Narrow>
    </ToolPage>
  );
}

/* ---------- One piece, polled on its own ---------- */

function SinglePiece({ id, initial }: { id: number; initial: Draft<"feedback"> | null }) {
  const { draft, restart, error } = useDraft<"feedback">(id, initial);
  if (error) return <li className="py-6 text-sm text-muted">This feedback isn't available.</li>;
  return <PieceCard summary={draft} draft={draft?.status === "ready" ? draft : null} onRetry={restart} />;
}

/* ---------- A batch: one poll for the whole set ---------- */

function BatchView({ batch, initial }: { batch: string; initial: DraftSummary[] }) {
  const [rows, setRows] = useState<DraftSummary[]>(initial);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [tick, setTick] = useState(0);
  const texts = useRef(new Map<number, string>());

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

  const onText = useCallback((pid: number, value: string) => {
    texts.current.set(pid, value);
  }, []);
  const copyAll = () =>
    rows
      .map((r) => texts.current.get(r.id))
      .filter(Boolean)
      .join("\n\n");

  const done = progress?.done ?? false;
  return (
    <OutputEditor label="Feedback" actions={
        done && progress!.ready > 0 ? (
          <span className="flex items-center gap-2">
            <CopyButton text={copyAll} label="Copy all" />
            <WordButton title="Feedback" text={copyAll} />
          </span>
        ) : undefined
      }>
      {!done && (
        <JobProgress
          className="pt-0"
          label={`Writing feedback… ${progress?.ready ?? 0} of ${progress?.total ?? rows.length}`}
          progress={progress?.progress ?? null}
          note="You can leave this page. Each piece will be under Recent."
        />
      )}
      <ol className="divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <BatchPiece key={r.id} summary={r} onText={onText} onRetry={() => setTick((n) => n + 1)} />
        ))}
      </ol>
    </OutputEditor>
  );
}

function BatchPiece({ summary, onText, onRetry }: { summary: DraftSummary; onText: (id: number, t: string) => void; onRetry: () => void }) {
  const [draft, setDraft] = useState<Draft<"feedback"> | null>(null);
  const ready = summary.status === "ready";
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    tools.get<"feedback">(summary.id).then((d) => alive && setDraft(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ready, summary.id]);
  return <PieceCard summary={summary} draft={ready ? draft : null} onText={onText} onRetry={onRetry} />;
}

/* ---------- The card ---------- */

function feedbackText(name: string, o: FeedbackOutput): string {
  const block = (title: string, items: FeedbackItem[]) => [title, ...items.map((p) => `- ${p.comment}`)].join("\n");
  return [name, block("Strengths", o.strengths), block("Next steps", o.next_steps)].join("\n\n");
}

function PieceCard({
  summary,
  draft,
  onText,
  onRetry,
}: {
  summary: DraftSummary | null;
  draft: Draft<"feedback"> | null;
  onText?: (id: number, t: string) => void;
  onRetry: (d: Draft<"feedback">) => void;
}) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  const name = summary?.title || "Feedback";
  useEffect(() => {
    if (summary && output) onText?.(summary.id, feedbackText(name, output));
  }, [summary, name, output, onText]);

  const setComment = (key: "strengths" | "next_steps", i: number, comment: string) =>
    output && setOutput({ ...output, [key]: output[key].map((p, j) => (j === i ? { ...p, comment } : p)) });

  const working = !summary || isWorking(summary.status);
  return (
    <li className="py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="min-w-0 truncate text-base font-medium">{name}</h3>
        <span className="flex shrink-0 items-center gap-3">
          {summary?.status === "ready" ? (
            <>
              <SaveHint state={saved} />
              {output && <CopyButton text={() => feedbackText(name, output)} />}
              {output && <WordButton title={`Feedback for ${name}`} text={() => feedbackText(name, output)} />}
            </>
          ) : (
            <span className={clsx("text-xs", summary?.status === "error" ? "text-danger" : "text-faint")} aria-live="polite">
              {summary ? statusWord(summary) : ""}
            </span>
          )}
        </span>
      </div>
      {working && <Progress value={summary?.status === "running" && summary.progress > 0 ? summary.progress * 100 : null} className="mt-4" />}
      {summary?.status === "error" && (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted">{summary.error || "Couldn't write feedback for this piece."}</p>
          <RetryButton<Draft<"feedback">> id={summary.id} onRetry={onRetry} />
        </div>
      )}
      {output && (
        <div className="mt-5 grid animate-slide-up gap-8 md:grid-cols-2 md:gap-10">
          {(["strengths", "next_steps"] as const).map((key) => (
            <div key={key}>
              <h4 className="label mb-3">{key === "strengths" ? "Strengths" : "Next steps"}</h4>
              <ul className="space-y-6">
                {output[key].map((p, i) => (
                  <li key={i}>
                    <EditableText label={key === "strengths" ? "Strength" : "Next step"} value={p.comment} onChange={(t) => setComment(key, i, t)} />
                    <blockquote className="mt-2 border-l border-line-strong pl-3 text-sm leading-[22px] text-muted">“{p.quote}”</blockquote>
                    {p.rubric && (
                      <span className="mt-2 inline-flex max-w-full items-center rounded-sm border border-line px-1.5 py-0.5 text-2xs text-faint" title={p.rubric}>
                        <span className="truncate">{p.rubric}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
