import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { FileText, X } from "lucide-react";
import { api, formatBytes } from "../../lib/api";
import type { DocumentRow } from "../../lib/types";
import { Progress } from "../../components/ui";
import { ToolPage, Narrow, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { statusWord, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import { isWorking, toForm, tools, type Draft, type FeedbackInput, type FeedbackOutput, type FeedbackPoint } from "../../lib/tools";

const PASTE = "paste";
const ACCEPT = ".txt,.md,.pdf,.docx,.doc,.rtf,text/plain";

export function Feedback() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"feedback"> } | null)?.draft ?? null;

  const [text, setText] = useState(initial?.input.text ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [rubric, setRubric] = useState(initial?.input.rubric_document_id ? String(initial.input.rubric_document_id) : "");
  const [rubricText, setRubricText] = useState(initial?.input.rubric_text ?? "");
  const [focus, setFocus] = useState(initial?.input.focus ?? "");
  const [studentId, setStudentId] = useState<number | null>(initial?.input.student_id ?? null);
  const [batch, setBatch] = useState<Draft<"feedback">[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const outputs = useRef(new Map<number, { name: string; output: FeedbackOutput | null }>());

  useEffect(() => {
    api
      .get<{ documents: DocumentRow[] }>("/api/documents")
      .then((r) => setDocs(r.documents.filter((d) => !/error|fail/i.test(d.status))))
      .catch(() => setDocs([]));
  }, []);

  // A batch stays on screen; a single draft (from Recent, or after one piece) comes from the URL.
  const pieces: { id: number; initial: Draft<"feedback"> | null }[] =
    id === null || batch.some((d) => d.id === id)
      ? batch.map((d) => ({ id: d.id, initial: d }))
      : [{ id, initial: initial?.id === id ? initial : null }];

  const addFiles = (list: FileList | null) => {
    // Copy now: the input is cleared right after, which empties the live FileList.
    const picked = Array.from(list ?? []);
    if (picked.length) setFiles((fs) => [...fs, ...picked]);
  };
  const hasWork = !!text.trim() || files.length > 0;
  const hasRubric = rubric === PASTE ? !!rubricText.trim() : true;

  const submit = async () => {
    setBusy(true);
    setFailure("");
    const input: FeedbackInput = {
      text: text.trim() || undefined,
      rubric_document_id: rubric && rubric !== PASTE ? Number(rubric) : null,
      rubric_text: rubric === PASTE ? rubricText.trim() : undefined,
      focus: focus.trim() || undefined,
      student_id: studentId,
    };
    try {
      const drafts = await tools.create("feedback", files.length ? toForm(input, files) : input);
      outputs.current.clear();
      setFiles([]);
      setBatch(drafts);
      if (drafts.length === 1) navigate(`/tools/feedback/${drafts[0]!.id}`, { state: { draft: drafts[0] } });
      else if (id !== null) navigate("/tools/feedback");
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onOutput = useCallback((pid: number, name: string, output: FeedbackOutput | null) => {
    outputs.current.set(pid, { name, output });
  }, []);

  const copyAll = () =>
    pieces
      .map((p) => outputs.current.get(p.id))
      .filter((x): x is { name: string; output: FeedbackOutput } => !!x?.output)
      .map((x) => `${pieces.length > 1 ? `${x.name}\n` : ""}${feedbackText(x.output)}`)
      .join("\n\n");

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
                <li key={`${f.name}-${i}`} className="flex animate-fadein items-center gap-3 py-2 pl-3 pr-1.5 text-sm">
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
            accept={ACCEPT}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </Labelled>

        <Labelled label="Rubric" htmlFor="fb-rubric">
          <select id="fb-rubric" className="input" value={rubric} onChange={(e) => setRubric(e.target.value)}>
            <option value="">No rubric</option>
            {docs.length > 0 && (
              <optgroup label="Documents">
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title || d.filename}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={PASTE}>Paste a rubric…</option>
          </select>
          {rubric === PASTE && (
            <textarea
              className="input mt-3 animate-fadein"
              rows={4}
              autoFocus
              aria-label="Rubric"
              placeholder="Paste the rubric here"
              value={rubricText}
              onChange={(e) => setRubricText(e.target.value)}
            />
          )}
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
          <button type="button" className="btn-primary btn-lg" disabled={!hasWork || !hasRubric || busy} onClick={submit}>
            {busy ? "Starting…" : files.length + (text.trim() ? 1 : 0) > 1 ? `Draft feedback (${files.length + (text.trim() ? 1 : 0)})` : "Draft feedback"}
          </button>
          <span className="text-sm text-faint">Drafts only. No grades.</span>
        </div>
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </Narrow>

      {pieces.length > 0 && (
        <Narrow>
          <OutputEditor label="Feedback" actions={<CopyButton text={copyAll} label={pieces.length > 1 ? "Copy all" : "Copy"} />}>
            <ol className="divide-y divide-line border-t border-line">
              {pieces.map((p, i) => (
                <PieceCard key={p.id} id={p.id} initial={p.initial} index={i} onOutput={onOutput} />
              ))}
            </ol>
          </OutputEditor>
        </Narrow>
      )}

      <Narrow>
        <DraftList tool="feedback" activeId={id} refreshKey={batch} />
      </Narrow>
    </ToolPage>
  );
}

function feedbackText(o: FeedbackOutput): string {
  const block = (title: string, pts: FeedbackPoint[]) => [title, ...pts.map((p) => `- ${p.text}`)].join("\n");
  return [block("Strengths", o.strengths ?? []), block("Next steps", o.next_steps ?? [])].join("\n\n");
}

function PieceCard({
  id,
  initial,
  index,
  onOutput,
}: {
  id: number;
  initial: Draft<"feedback"> | null;
  index: number;
  onOutput: (id: number, name: string, o: FeedbackOutput | null) => void;
}) {
  const { draft } = useDraft<"feedback">(id, initial);
  const { output, setOutput, saved } = useDraftOutput(draft);
  const name = draft?.filename || draft?.title || `Piece ${index + 1}`;
  useEffect(() => onOutput(id, name, output), [id, name, output, onOutput]);

  const setPoint = (key: "strengths" | "next_steps", i: number, text: string) =>
    output && setOutput({ ...output, [key]: output[key].map((p, j) => (j === i ? { ...p, text } : p)) });

  const working = !draft || isWorking(draft.status);
  return (
    <li className="py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="min-w-0 truncate text-base font-medium">{name}</h3>
        <span className={clsx("shrink-0 text-xs", draft?.status === "error" ? "text-danger" : "text-faint")} aria-live="polite">
          {draft && draft.status !== "ready" ? statusWord(draft) : saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}
        </span>
      </div>
      {working && <Progress value={draft?.progress ? draft.progress : null} className="mt-4" />}
      {draft?.status === "error" && <p className="mt-2 text-sm text-muted">{draft.error || "Couldn't read this piece."}</p>}
      {draft?.status === "ready" && output && (
        <div className="mt-5 grid animate-slide-up gap-8 md:grid-cols-2 md:gap-10">
          {(["strengths", "next_steps"] as const).map((key) => (
            <div key={key}>
              <h4 className="label mb-3">{key === "strengths" ? "Strengths" : "Next steps"}</h4>
              <ul className="space-y-6">
                {(output[key] ?? []).map((p, i) => (
                  <li key={i}>
                    <EditableText label={key === "strengths" ? "Strength" : "Next step"} value={p.text} onChange={(t) => setPoint(key, i, t)} />
                    {p.quote && (
                      <blockquote className="mt-2 border-l border-line-strong pl-3 text-sm leading-[22px] text-muted">“{p.quote}”</blockquote>
                    )}
                    {p.rubric && (
                      <span className="mt-2 inline-flex max-w-full items-center rounded-sm border border-line px-1.5 py-0.5 text-2xs text-faint">
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
