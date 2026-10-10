import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker, useStudent } from "../../components/tools/StudentPicker";
import { JobProgress, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, OutputEditor, SaveHint, useDraftOutput } from "../../components/tools/OutputEditor";
import { DraftList } from "../../components/tools/DraftList";
import { LANGUAGES, isWorking, tools, type Draft, type Tone } from "../../lib/tools";

const TONES: { value: Tone; label: string }[] = [
  { value: "warm", label: "Warm" },
  { value: "neutral", label: "Neutral" },
  { value: "firm", label: "Firm" },
];

export function ParentEmail() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"email"> } | null)?.draft ?? null;
  const { draft, error } = useDraft<"email">(id, initial);

  const seed = initial?.input;
  const [studentId, setStudentId] = useState<number | null>(seed?.student_id ?? null);
  const [topic, setTopic] = useState(seed?.topic ?? "");
  const [tone, setTone] = useState<Tone>(seed?.tone ?? "warm");
  const [language, setLanguage] = useState(seed?.language ?? "English");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const student = useStudent(studentId);
  const home = student?.home_language?.trim();
  const suggest = home && !/^english$/i.test(home) && home !== language ? home : null;

  const submit = async () => {
    if (studentId === null) return;
    setBusy(true);
    setFailure("");
    try {
      const [d] = await tools.create("email", { student_id: studentId, topic: topic.trim(), tone, language });
      navigate(`/tools/email/${d!.id}`, { state: { draft: d } });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const languages = home && !LANGUAGES.includes(home) ? [...LANGUAGES, home] : LANGUAGES;

  return (
    <ToolPage title="Email">
      <Narrow className="space-y-8">
        <Labelled label="Student" htmlFor="em-student" className="max-w-sm">
          <StudentPicker id="em-student" value={studentId} onChange={setStudentId} placeholder="Choose a student" />
        </Labelled>
        <Labelled label="What's it about?" htmlFor="em-topic">
          <input
            id="em-topic"
            className="input"
            placeholder="e.g. Great progress on the science project"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && studentId !== null && topic.trim() && submit()}
          />
        </Labelled>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-8">
          <Labelled label="Tone">
            <Choice label="Tone" options={TONES} value={tone} onChange={setTone} />
          </Labelled>
          <Labelled label="Language" htmlFor="em-lang" className="w-full max-w-[14rem]">
            <select id="em-lang" className="input h-8 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {suggest && (
              <button type="button" className="btn-link mt-2 animate-fadein font-normal" onClick={() => setLanguage(suggest)}>
                Use {suggest}, the family's language
              </button>
            )}
          </Labelled>
        </div>

        <button type="button" className="btn-primary btn-lg" disabled={studentId === null || !topic.trim() || busy} onClick={submit}>
          {busy ? "Starting…" : "Draft email"}
        </button>
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </Narrow>

      {id !== null && (
        <Narrow>
          {error ? (
            <ErrorLine>This email isn't available.</ErrorLine>
          ) : !draft ? (
            <SkeletonText lines={4} />
          ) : isWorking(draft.status) ? (
            <JobProgress label="Writing…" progress={draft.progress} />
          ) : draft.status === "error" ? (
            <ErrorLine>{draft.error || "Couldn't draft this email."}</ErrorLine>
          ) : (
            <EmailResult draft={draft} />
          )}
        </Narrow>
      )}

      <Narrow>
        <DraftList tool="email" activeId={id} refreshKey={draft?.status} />
      </Narrow>
    </ToolPage>
  );
}

function EmailResult({ draft }: { draft: Draft<"email"> }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  if (!output) return null;
  const mailto = `mailto:?subject=${encodeURIComponent(output.subject)}&body=${encodeURIComponent(output.body)}`;
  return (
    <OutputEditor>
      <div className="rounded border border-line bg-panel">
        <input
          aria-label="Subject"
          className="w-full rounded-t border-b border-line bg-transparent px-5 py-3.5 text-base font-medium text-ink outline-none focus:bg-subtle/40"
          value={output.subject}
          onChange={(e) => setOutput({ ...output, subject: e.target.value })}
        />
        <AutoBody value={output.body} onChange={(body) => setOutput({ ...output, body })} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <CopyButton text={() => `Subject: ${output.subject}\n\n${output.body}`} size="md" />
          <a href={mailto} className="btn-secondary">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open in Mail
          </a>
        </div>
        <span className="text-sm text-faint">Nothing is sent automatically.</span>
        <SaveHint state={saved} />
      </div>
    </OutputEditor>
  );
}

function AutoBody({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(200, el.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label="Body"
      rows={8}
      className="block w-full resize-none overflow-hidden rounded-b bg-transparent px-5 py-4 text-base leading-[26px] text-ink outline-none focus:bg-subtle/40"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
