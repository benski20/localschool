import { useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FileText, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { JobProgress, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import { GRADES, LANGUAGES, isWorking, toForm, tools, type AdaptInput, type AdaptMode, type Draft } from "../../lib/tools";

const MODES: { value: AdaptMode; label: string }[] = [
  { value: "level", label: "Reading level" },
  { value: "student", label: "For a student" },
  { value: "translate", label: "Translate" },
];

export function Adapt() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"adapt"> } | null)?.draft ?? null;
  const { draft, error } = useDraft<"adapt">(id, initial);

  const seed = initial?.input;
  const [text, setText] = useState(seed?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<AdaptMode>(seed?.mode ?? "level");
  const [grade, setGrade] = useState(seed?.grade ?? "4");
  const [studentId, setStudentId] = useState<number | null>(seed?.student_id ?? null);
  const [language, setLanguage] = useState(seed?.language ?? "Spanish");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  const ready = (!!text.trim() || !!file) && (mode !== "student" || studentId !== null);

  const submit = async () => {
    setBusy(true);
    setFailure("");
    const input: AdaptInput = {
      text: file ? undefined : text.trim(),
      mode,
      grade: mode === "level" ? grade : undefined,
      student_id: mode === "student" ? studentId : null,
      language: mode === "translate" ? language : undefined,
    };
    try {
      const [d] = await tools.create("adapt", file ? toForm(input, [file], "file") : input);
      navigate(`/tools/adapt/${d!.id}`, { state: { draft: d } });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolPage title="Adapt" width="medium">
      <div className="space-y-8">
        <Labelled label="Text" htmlFor="adapt-text">
          {file ? (
            <div className="flex animate-fadein items-center gap-3 rounded border border-line bg-panel py-2 pl-3 pr-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label="Remove file" onClick={() => setFile(null)}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <textarea
                id="adapt-text"
                className="input"
                rows={7}
                placeholder="Paste a reading"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="button" className="btn-link mt-3 font-normal" onClick={() => picker.current?.click()}>
                Upload a file
              </button>
            </>
          )}
          <input
            ref={picker}
            type="file"
            hidden
            accept=".txt,.md,.pdf,.docx,.doc,.rtf,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </Labelled>

        <div className="space-y-4">
          <Choice label="How to adapt" options={MODES} value={mode} onChange={setMode} />
          <div className="max-w-xs">
            {mode === "level" && (
              <select className="input" aria-label="Reading level" value={grade} onChange={(e) => setGrade(e.target.value)}>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
            )}
            {mode === "student" && <StudentPicker value={studentId} onChange={setStudentId} placeholder="Choose a student" />}
            {mode === "translate" && (
              <select className="input" aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.filter((l) => l !== "English").map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <button type="button" className="btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
          {busy ? "Starting…" : "Adapt"}
        </button>
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </div>

      {id !== null &&
        (error ? (
          <Narrow>
            <ErrorLine>This reading isn't available.</ErrorLine>
          </Narrow>
        ) : !draft ? (
          <Narrow>
            <SkeletonText lines={4} />
          </Narrow>
        ) : isWorking(draft.status) ? (
          <Narrow>
            <JobProgress label="Adapting…" progress={draft.progress} />
          </Narrow>
        ) : draft.status === "error" ? (
          <Narrow>
            <ErrorLine>{draft.error || "Couldn't adapt this text."}</ErrorLine>
          </Narrow>
        ) : (
          <Result draft={draft} />
        ))}

      <Narrow>
        <DraftList tool="adapt" activeId={id} refreshKey={draft?.status} />
      </Narrow>
    </ToolPage>
  );
}

function Result({ draft }: { draft: Draft<"adapt"> }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  if (!output) return null;
  const original = output.original ?? draft.input.text ?? "";
  const glossary = output.glossary ?? [];
  const copyText = () =>
    [output.adapted, glossary.length ? `\nWords to know\n${glossary.map((g) => `${g.term}: ${g.definition}`).join("\n")}` : ""].join("");

  return (
    <div className="grid animate-fade-in gap-12 md:grid-cols-2 md:gap-14">
      <section className="min-w-0 animate-slide-up">
        <h2 className="label mb-4 flex min-h-7 items-center">Original</h2>
        <p className="whitespace-pre-wrap text-base leading-[26px] text-muted">{original}</p>
      </section>
      <OutputEditor label="Adapted" saved={saved} actions={<CopyButton text={copyText} />} className="min-w-0">
        <EditableText label="Adapted text" value={output.adapted} onChange={(adapted) => setOutput({ ...output, adapted })} />
        {glossary.length > 0 && (
          <div className="mt-10">
            <h3 className="label mb-3">Words to know</h3>
            <dl className="space-y-2">
              {glossary.map((g, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,8rem)_1fr] items-baseline gap-4 text-sm">
                  <dt className="truncate text-ink">{g.term}</dt>
                  <dd>
                    <EditableText
                      label={`Meaning of ${g.term}`}
                      value={g.definition}
                      className="text-sm leading-[22px] text-muted"
                      onChange={(definition) =>
                        setOutput({ ...output, glossary: glossary.map((x, j) => (j === i ? { ...x, definition } : x)) })
                      }
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </OutputEditor>
    </div>
  );
}
