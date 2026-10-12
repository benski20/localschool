import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Plus, RotateCcw, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Labelled, ErrorLine, Chip } from "../../components/tools/ToolPage";
import { useRoster } from "../../components/tools/StudentPicker";
import { DraftProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { EditableText, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import { DocHeader } from "../../components/tools/DocHeader";
import { FileRow } from "../../components/tools/FileRow";
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

const TITLE = "Adapt a reading";

export function Adapt() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const state = useLocation().state as { draft?: Draft<"adapt">; from?: Draft<"adapt"> } | null;
  const { draft, restart, error } = useDraft<"adapt">(id, state?.draft ?? null);
  const meta = useToolsMeta();
  const roster = useRoster();

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [wants, setWants] = useState<Want[]>([{ who: "level:grade_4", language: "English" }]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  // A draft that was opened (or "Adapt again" from one) fills the form with what it was asked,
  // ready for a variation.
  const source = draft ?? state?.from ?? null;
  const seeded = useRef<number | null>(null);
  useEffect(() => {
    if (!source || seeded.current === source.id) return;
    seeded.current = source.id;
    setFile(null);
    setText(source.input.text ?? "");
    const asked = (source.input.versions ?? []) as { level: string; language: string; student: { id: number } | null }[];
    if (asked.length)
      setWants(asked.map((v) => ({ who: v.student ? `student:${v.student.id}` : `level:${v.level}`, language: v.language || "English" })));
  }, [source]);

  // A finished reading reads like a document: its own header, no tool chrome.
  if (id !== null && draft && !error && draft.status === "ready" && draft.output) {
    return <AdaptDoc draft={draft} onAgain={() => navigate("/tools/adapt", { state: { from: draft } })} />;
  }

  // Waiting for (or reporting on) a reading that was just sent.
  if (id !== null) {
    return (
      <ToolPage title={TITLE}>
        <Narrow className="space-y-4">
          {error ? (
            <ErrorLine>This reading isn't available.</ErrorLine>
          ) : !draft ? (
            <SkeletonText lines={4} />
          ) : isWorking(draft.status) ? (
            <DraftProgress draft={draft} />
          ) : (
            <>
              <ErrorLine>{draft.error || "Couldn't adapt this reading."}</ErrorLine>
              <RetryButton<Draft<"adapt">> id={draft.id} onRetry={restart} />
            </>
          )}
        </Narrow>
      </ToolPage>
    );
  }

  const max = meta?.limits.adapt_versions ?? 3;
  const ready = !!text.trim() || !!file;
  const setWant = (i: number, patch: Partial<Want>) => setWants((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const students = [...(roster?.students ?? [])].sort((a, b) => a.name.localeCompare(b.name));

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

  return (
    <ToolPage title={TITLE} subtitle="Make a text easier to read, or translate it.">
      <Narrow className="space-y-6">
        <Labelled label="Reading" htmlFor="adapt-text">
          {file ? (
            <FileRow name={file.name} size={file.size} onRemove={() => setFile(null)} />
          ) : (
            <>
              <textarea id="adapt-text" className="input" rows={7} placeholder="Paste a reading" value={text} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="btn-link mt-2 font-normal" onClick={() => picker.current?.click()}>
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

        <Labelled label={wants.length > 1 ? "Versions" : "Make it"}>
          <ul className="space-y-2">
            {wants.map((w, i) => (
              <li
                key={i}
                className="flex h-10 animate-fade-in items-center rounded-lg bg-ink/[0.04] transition-[border-color,box-shadow] duration-fast focus-within:border-ink/30 focus-within:shadow-[0_0_0_3px_rgb(var(--text)/0.06)] hover:bg-ink/[0.06]"
              >
                <select
                  className={clsx(BARE, "flex-[3]")}
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
                <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
                <select
                  className={clsx(BARE, "flex-[2]")}
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
                    className="btn-ghost btn-icon btn-sm mr-1 shrink-0 text-faint"
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
              className="btn-link mt-2 font-normal"
              onClick={() => setWants((ws) => [...ws, { who: "level:simpler", language: "English" }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Another version
            </button>
          )}
        </Labelled>

        <div className="space-y-3 pt-2">
          <button type="button" className="btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
            {busy ? "Starting…" : "Adapt"}
          </button>
          {failure && <ErrorLine>{failure}</ErrorLine>}
        </div>
      </Narrow>

      <Narrow>
        <DraftList tool="adapt" activeId={null} refreshKey={draft?.status} />
      </Narrow>
    </ToolPage>
  );
}

/** A select that sits borderless inside the shared rounded group. */
const BARE = "input h-full min-w-0 rounded-none border-0 bg-transparent shadow-none focus:shadow-none";

const about = (r: Readability) => [r.grade !== null ? `about grade ${Math.round(r.grade)}` : "", `${r.words} words`].filter(Boolean).join(" · ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function versionText(v: AdaptVersion): string {
  const head = v.title ? `${v.title}\n\n` : "";
  const words = v.glossary.length ? `\n\nWords to know\n${v.glossary.map((g) => `${g.term}: ${g.meaning}`).join("\n")}` : "";
  return `${head}${v.text}${words}`;
}

/** The adapted reading as a document: one version at a time, a pill toggle to switch. */
function AdaptDoc({ draft, onAgain }: { draft: Draft<"adapt">; onAgain: () => void }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  const [active, setActive] = useState(0);
  if (!output) return null;
  const n = output.versions.length;
  const i = Math.min(active, n - 1);
  const v = output.versions[i]!;
  const setVersion = (patch: Partial<AdaptVersion>) =>
    setOutput({ ...output, versions: output.versions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const original = output.original;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
      <DocHeader
        back={{ to: "/tools/adapt", label: TITLE }}
        title={
          v.title ? (
            // Editable in place; the wide inner box lets the title fill the row up to Copy and ⋯.
            <span className="block w-screen max-w-full">
              <EditableText
                single
                label="Title"
                value={v.title}
                onChange={(title) => setVersion({ title })}
                className="!py-0 font-serif !text-[32px] !leading-[40px] tracking-[-0.01em] sm:!text-[36px] sm:!leading-[44px]"
              />
            </span>
          ) : (
            "Adapted reading"
          )
        }
        saved={saved}
        copy={() => versionText(v)}
        word={{ title: v.title || v.label, text: () => versionText(v) }}
        menu={[{ label: "Adapt again", icon: <RotateCcw className="h-4 w-4" aria-hidden />, onSelect: onAgain }]}
        chips={
          <>
            {n > 1 && (
              <span role="tablist" aria-label="Versions" className="segmented max-w-full overflow-x-auto">
                {output.versions.map((x, j) => (
                  <button key={j} type="button" role="tab" aria-selected={j === i} onClick={() => setActive(j)}>
                    {x.label}
                  </button>
                ))}
              </span>
            )}
            <Chip>{n > 1 ? cap(about(v.readability)) : `${v.label} · ${about(v.readability)}`}</Chip>
            <Chip>Original · {about(original)}</Chip>
          </>
        }
      />

      <article key={i} className="mt-10 animate-fade-in" aria-label={v.label}>
        <EditableText label={`${v.label} text`} value={v.text} onChange={(t) => setVersion({ text: t })} className="!text-[17px] !leading-[28px]" />

        {v.glossary.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-base font-medium text-ink">Words to know</h2>
            <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {v.glossary.map((g, k) => (
                <div key={k} className="-mx-2 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-ink/[0.03] focus-within:bg-ink/[0.03]">
                  <dt className="text-sm font-medium text-ink">{g.term}</dt>
                  <dd>
                    <EditableText
                      label={`Meaning of ${g.term}`}
                      value={g.meaning}
                      className="!py-0 !text-sm !leading-[22px] !text-muted"
                      onChange={(meaning) => setVersion({ glossary: v.glossary.map((x, j) => (j === k ? { ...x, meaning } : x)) })}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {v.changes && <p className="mt-12 text-sm text-faint">{v.changes}</p>}
      </article>
    </div>
  );
}
