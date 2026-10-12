import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine, Reveal } from "../../components/tools/ToolPage";
import { StudentPicker, useStudent } from "../../components/tools/StudentPicker";
import { DraftProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { DraftList } from "../../components/tools/DraftList";
import { EmailDoc } from "../../components/tools/email/EmailDoc";
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
  const { draft, restart, error } = useDraft<"email">(id, initial);

  const [studentId, setStudentId] = useState<number | null>(null);
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<Tone>("warm");
  const [language, setLanguage] = useState("English");
  const [busy, setBusy] = useState(false);

  // A draft reopened from Recent fills the form with what it was asked, ready for a variation.
  const seeded = useRef<number | null>(null);
  useEffect(() => {
    if (!draft || seeded.current === draft.id) return;
    seeded.current = draft.id;
    setStudentId(draft.student?.id ?? null);
    setTopic(draft.input.topic ?? "");
    setTone(draft.input.tone ?? "warm");
    setLanguage(draft.input.language ?? "English");
  }, [draft]);
  const [failure, setFailure] = useState("");
  const student = useStudent(studentId);
  const home = student?.home_language?.trim();
  const suggest = home && !/^english$/i.test(home) && home !== language ? home : null;

  const submit = async () => {
    if (studentId === null) return;
    setBusy(true);
    setFailure("");
    try {
      const { draft: d } = await tools.create("email", { student_id: studentId, topic: topic.trim(), tone, language });
      navigate(`/tools/email/${d.id}`, { state: { draft: d } });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A finished email reads like a mail composer, on its own page (like a finished meeting).
  if (id !== null && draft && !error && draft.status === "ready" && draft.output) {
    return <EmailDoc draft={draft} />;
  }

  const languages = home && !LANGUAGES.includes(home) ? [...LANGUAGES, home] : LANGUAGES;
  const ready = studentId !== null && topic.trim() !== "" && !busy;

  return (
    <ToolPage title="Parent email" subtitle="Draft a note home. Nothing is sent automatically.">
      <Narrow className="space-y-6">
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
            onKeyDown={(e) => e.key === "Enter" && ready && submit()}
          />
        </Labelled>
        <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
          {/* The pill toggle stretched to the select's 40px height, three equal segments. */}
          <Labelled label="Tone" className="[&_.segmented>button]:h-[34px] [&_.segmented>button]:flex-1 [&_.segmented]:flex">
            <Choice label="Tone" options={TONES} value={tone} onChange={setTone} />
          </Labelled>
          <Labelled label="Language" htmlFor="em-lang">
            <select id="em-lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {suggest && (
              <button type="button" className="btn-link mt-2 animate-fade-in text-sm font-normal" onClick={() => setLanguage(suggest)}>
                Use {suggest}, the family's language
              </button>
            )}
          </Labelled>
        </div>

        <div className="pt-2">
          <button type="button" className="btn-primary btn-lg" disabled={!ready} onClick={submit}>
            {busy ? "Starting…" : "Draft email"}
          </button>
        </div>
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </Narrow>

      <Reveal id={id}>
        {id !== null && (
          <Narrow>
            {error ? (
              <ErrorLine>This email isn't available.</ErrorLine>
            ) : !draft ? (
              <SkeletonText lines={4} />
            ) : isWorking(draft.status) ? (
              <DraftProgress draft={draft} />
            ) : draft.status === "error" ? (
              <div className="space-y-4">
                <ErrorLine>{draft.error || "Couldn't draft this email."}</ErrorLine>
                <RetryButton<Draft<"email">> id={draft.id} onRetry={restart} />
              </div>
            ) : null}
          </Narrow>
        )}
      </Reveal>

      <Narrow>
        <DraftList tool="email" activeId={id} refreshKey={draft?.status} />
      </Narrow>
    </ToolPage>
  );
}
