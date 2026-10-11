import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { FileText, Plus, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Labelled, ErrorLine, Reveal } from "../../components/tools/ToolPage";
import { useRoster } from "../../components/tools/StudentPicker";
import { DraftProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, WordButton, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import {
  LANGUAGES,
  isWorking,
  toForm,
  tools,
  useToolsMeta,
  type AdaptCreate,
  type AdaptVersion,
  type AdaptVersionIn,
  type Draft,
  type Readability,
} from "../../lib/tools";

/** One version the teacher asks for: `who` is "level:<key>" or "student:<id>". */
interface Want {
  who: string;
  language: string;
}

const toVersion = (w: Want): AdaptVersionIn => {
  const [kind, value] = w.who.split(":") as [string, string];
  const language = w.language === "English" ? undefined : w.language;
  return kind === "student" ? { student_id: Number(value), language } : { level: value, language };
};

export function Adapt() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"adapt"> } | null)?.draft ?? null;
  const { draft, restart, error } = useDraft<"adapt">(id, initial);
  const meta = useToolsMeta();
  const roster = useRoster();

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [wants, setWants] = useState<Want[]>([{ who: "level:grade_4", language: "English" }]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  // A draft reopened from Recent fills the form with what it was asked, ready for a variation.
  const seeded = useRef<number | null>(null);
  useEffect(() => {
    if (!draft || seeded.current === draft.id) return;
    seeded.current = draft.id;
    setFile(null);
    setText(draft.input.text ?? "");
    const asked = (draft.input.versions ?? []) as { level: string; language: string; student: { id: number } | null }[];
    if (asked.length)
      setWants(asked.map((v) => ({ who: v.student ? `student:${v.student.id}` : `level:${v.level}`, language: v.language || "English" })));
  }, [draft]);

  const max = meta?.limits.adapt_versions ?? 3;
  const ready = !!text.trim() || !!file;
  const setWant = (i: number, patch: Partial<Want>) => setWants((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const submit = async () => {
    setBusy(true);
    setFailure("");
    const versions = wants.map(toVersion);
    try {
      const body: AdaptCreate | FormData = file ? toForm({ versions }, [file], "file") : { text: text.trim(), versions };
      const { draft: d } = await tools.create("adapt", body);
      navigate(`/tools/adapt/${d.id}`, { state: { draft: d } });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const students = [...(roster?.students ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ToolPage title="Adapt" width={id !== null && draft?.status === "ready" && (draft.output?.versions.length ?? 1) > 1 ? "wide" : "narrow"}>
      <Narrow className="space-y-8">
        <Labelled label="Reading" htmlFor="adapt-text">
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
              <textarea id="adapt-text" className="input" rows={7} placeholder="Paste a reading" value={text} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="btn-link mt-3 font-normal" onClick={() => picker.current?.click()}>
                Upload a file
              </button>
            </>
          )}
          <input
            ref={picker}
            type="file"
            hidden
            accept=".txt,.md,.pdf,.docx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </Labelled>

        <div>
          <p className="field-label">{wants.length > 1 ? "Versions" : "Make it"}</p>
          <ul className="space-y-3">
            {wants.map((w, i) => (
              <li key={i} className="flex animate-fadein items-center gap-2 sm:gap-3">
                <select
                  className="input min-w-0 flex-[3]"
                  aria-label={`Version ${i + 1} level or student`}
                  value={w.who}
                  onChange={(e) => setWant(i, { who: e.target.value })}
                >
                  <optgroup label="Reading level">
                    {(meta?.adapt_levels ?? [{ key: "grade_4", label: "Grade 4" }]).map((l) => (
                      <option key={l.key} value={`level:${l.key}`}>
                        {l.label}
                      </option>
                    ))}
                  </optgroup>
                  {students.length > 0 && (
                    <optgroup label="For a student">
                      {students.map((s) => (
                        <option key={s.id} value={`student:${s.id}`}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <select
                  className="input min-w-0 flex-[2]"
                  aria-label={`Version ${i + 1} language`}
                  value={w.language}
                  onChange={(e) => setWant(i, { language: e.target.value })}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                {wants.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost btn-icon btn-sm shrink-0 text-faint"
                    aria-label={`Remove version ${i + 1}`}
                    onClick={() => setWants((ws) => ws.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {wants.length < max && (
            <button
              type="button"
              className="btn-link mt-3 font-normal"
              onClick={() => setWants((ws) => [...ws, { who: "level:simpler", language: "English" }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Another version
            </button>
          )}
        </div>

        <button type="button" className="btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
          {busy ? "Starting…" : "Adapt"}
        </button>
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </Narrow>

      <Reveal id={id}>
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
            <DraftProgress draft={draft} />
          </Narrow>
        ) : draft.status === "error" ? (
          <Narrow className="space-y-4">
            <ErrorLine>{draft.error || "Couldn't adapt this reading."}</ErrorLine>
            <RetryButton<Draft<"adapt">> id={draft.id} onRetry={restart} />
          </Narrow>
        ) : (
          <Result draft={draft} />
        ))}
      </Reveal>

      <Narrow>
        <DraftList tool="adapt" activeId={id} refreshKey={draft?.status} />
      </Narrow>
    </ToolPage>
  );
}

const about = (r: Readability) => [r.grade !== null ? `about grade ${Math.round(r.grade)}` : "", `${r.words} words`].filter(Boolean).join(" · ");

function versionText(v: AdaptVersion): string {
  const head = v.title ? `${v.title}\n\n` : "";
  const words = v.glossary.length ? `\n\nWords to know\n${v.glossary.map((g) => `${g.term}: ${g.meaning}`).join("\n")}` : "";
  return `${head}${v.text}${words}`;
}

function Result({ draft }: { draft: Draft<"adapt"> }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  if (!output) return null;
  const n = output.versions.length;
  const setVersion = (i: number, patch: Partial<AdaptVersion>) =>
    setOutput({ ...output, versions: output.versions.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <OutputEditor label="Adapted" saved={saved}>
      <p className="-mt-2 mb-8 text-sm text-faint">Original: {about(output.original)}</p>
      <div className={clsx("grid gap-12", n === 2 && "lg:grid-cols-2 lg:gap-14", n === 3 && "lg:grid-cols-3 lg:gap-10")}>
        {output.versions.map((v, i) => (
          <section key={i} className="min-w-0 animate-slide-up" aria-label={v.label}>
            <div className="mb-1 flex items-center justify-between gap-3 border-b border-line pb-3">
              <h3 className="min-w-0 truncate text-base font-medium">{v.label}</h3>
              <span className="flex shrink-0 items-center gap-2">
                <CopyButton text={() => versionText(v)} />
                <WordButton title={() => v.title || v.label} text={() => versionText(v)} />
              </span>
            </div>
            <p className="mb-5 mt-2 text-xs text-faint">{about(v.readability)}</p>
            {v.title && (
              <EditableText label="Title" value={v.title} onChange={(title) => setVersion(i, { title })} className="mb-2 text-lg font-medium" />
            )}
            <EditableText label={`${v.label} text`} value={v.text} onChange={(t) => setVersion(i, { text: t })} />
            {v.glossary.length > 0 && (
              <div className="mt-10">
                <h4 className="label mb-3">Words to know</h4>
                <dl className="space-y-2">
                  {v.glossary.map((g, k) => (
                    <div key={k} className="grid grid-cols-[minmax(0,8rem)_1fr] items-baseline gap-4 text-sm">
                      <dt className="truncate text-ink">{g.term}</dt>
                      <dd>
                        <EditableText
                          label={`Meaning of ${g.term}`}
                          value={g.meaning}
                          className="text-sm leading-[22px] text-muted"
                          onChange={(meaning) => setVersion(i, { glossary: v.glossary.map((x, j) => (j === k ? { ...x, meaning } : x)) })}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {v.changes && <p className="mt-8 text-sm text-faint">{v.changes}</p>}
          </section>
        ))}
      </div>
    </OutputEditor>
  );
}
