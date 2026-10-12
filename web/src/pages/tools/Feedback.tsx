import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { api } from "../../lib/api";
import type { DocumentRow } from "../../lib/types";
import { ToolPage, Narrow, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { DraftList } from "../../components/tools/DraftList";
import { FileList, FileRow } from "../../components/tools/FileRow";
import { BatchDoc, FeedbackDoc, type Skipped } from "../../components/tools/feedback/FeedbackDoc";
import { toForm, tools, type Draft, type FeedbackCreate } from "../../lib/tools";

/** What the page carries in history: the draft just made, a batch, and any files that were skipped. */
interface NavState {
  draft?: Draft<"feedback">;
  batch?: { id: string; drafts: Draft<"feedback">[] };
  skipped?: Skipped;
}

const PASTE = "paste";
const UPLOAD = "upload";
const ACCEPT = ".txt,.md,.pdf,.docx";

export function Feedback() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const nav = useLocation().state as NavState | null;
  const initial = nav?.draft ?? null;
  // A batch stays open (in history) until the teacher goes back to the form.
  const batch = nav?.batch && (id === null || nav.batch.drafts.some((d) => d.id === id)) ? nav.batch : null;

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [rubric, setRubric] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [focus, setFocus] = useState("");
  const [studentId, setStudentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
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
      const skipped = res.errors.length ? res.errors : undefined;
      if (res.batch) navigate("/tools/feedback", { state: { batch: { id: res.batch, drafts: res.drafts }, skipped } satisfies NavState });
      else navigate(`/tools/feedback/${res.draft.id}`, { state: { draft: res.draft, skipped } satisfies NavState });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // An open draft or batch reads like a document: its own header, no form.
  if (batch) return <BatchDoc batch={batch.id} initial={batch.drafts} selectedId={id} skipped={nav?.skipped} />;
  if (id !== null) return <FeedbackDoc key={id} id={id} initial={initial?.id === id ? initial : null} skipped={nav?.skipped} />;

  const removeFile = (i: number) => setFiles((fs) => fs.filter((_, j) => j !== i));

  return (
    <ToolPage title="Feedback" subtitle="Draft comments on student work. Drafts only — no grades.">
      <Narrow className="space-y-6">
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
            className={clsx(
              "rounded-xl transition-shadow duration-fast",
              drag && "shadow-[0_0_0_4px_rgb(var(--accent)/0.18)] [&>textarea]:border-accent/60",
            )}
          >
            <textarea
              id="fb-work"
              className="input"
              rows={7}
              placeholder="Paste student work, or drop files here"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <FileList className="mt-2" files={files} onRemove={removeFile} />
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
              className="input mt-2 animate-slide-down"
              rows={4}
              aria-label="Rubric text"
              placeholder="Paste the rubric here, one criterion per line"
              value={rubricText}
              onChange={(e) => setRubricText(e.target.value)}
            />
          )}
          {rubric === UPLOAD && rubricFile && (
            <FileRow className="mt-2 animate-slide-down" name={rubricFile.name} size={rubricFile.size} onRemove={() => setRubricFile(null)} />
          )}
          {rubric === UPLOAD && !rubricFile && (
            <button type="button" className="btn-link mt-3 animate-fade-in font-normal" onClick={() => rubricPicker.current?.click()}>
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

        <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
          <Labelled label="Focus" optional htmlFor="fb-focus">
            <input id="fb-focus" className="input" placeholder="e.g. use of evidence" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Labelled>
          <Labelled label="Student" optional htmlFor="fb-student">
            <StudentPicker id="fb-student" value={studentId} onChange={setStudentId} />
          </Labelled>
        </div>

        <div className="space-y-4 pt-2">
          <button type="button" className="btn-primary btn-lg" disabled={!pieces || !hasRubric || busy} onClick={submit}>
            {busy ? "Starting…" : pieces > 1 ? `Draft feedback for ${pieces}` : "Draft feedback"}
          </button>
          {failure && <ErrorLine>{failure}</ErrorLine>}
        </div>
      </Narrow>

      <Narrow>
        <DraftList tool="feedback" />
      </Narrow>
    </ToolPage>
  );
}
