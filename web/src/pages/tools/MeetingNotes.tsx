import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, Plus, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { ConsentRecorder } from "../../components/tools/ConsentRecorder";
import { JobProgress, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { RefChips, TranscriptView, clock, type TranscriptFocus } from "../../components/tools/TranscriptView";
import { DraftList } from "../../components/tools/DraftList";
import {
  MEETING_TYPES,
  isWorking,
  tools,
  type ActionItem,
  type Draft,
  type MeetingNotes as Notes,
  type MeetingType,
  type NoteItem,
  type Segment,
} from "../../lib/tools";

const AUDIO = ".m4a,.mp3,.wav,.webm,.ogg,audio/*";

export function MeetingNotes() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"meeting"> } | null)?.draft ?? null;
  const { draft, setDraft, error } = useDraft<"meeting">(id, initial);

  const [type, setType] = useState<MeetingType>("iep");
  const [studentId, setStudentId] = useState<number | null>(null);
  const [mode, setMode] = useState<"record" | "paste">("record");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [recording, setRecording] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const open = (d: Draft<"meeting">) => navigate(`/tools/meeting/${d.id}`, { state: { draft: d } });

  const run = async (go: () => Promise<Draft<"meeting">>) => {
    setBusy(true);
    setFailure("");
    try {
      open(await go());
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendAudio = (audio: Blob, name: string) =>
    run(async () => {
      const [d] = await tools.create("meeting", { meeting_type: type, student_id: studentId });
      return tools.uploadAudio(d!.id, audio, name);
    });

  const sendTranscript = () =>
    run(async () => (await tools.create("meeting", { meeting_type: type, student_id: studentId, transcript: pasted.trim() }))[0]!);

  const links = (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <button type="button" className="btn-link font-normal" onClick={() => file.current?.click()}>
        Upload a recording
      </button>
      <button type="button" className="btn-link font-normal" onClick={() => setMode("paste")}>
        Paste a transcript
      </button>
      <input
        ref={file}
        type="file"
        accept={AUDIO}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) sendAudio(f, f.name);
        }}
      />
    </div>
  );

  return (
    <ToolPage title="Meeting" width={draft?.status === "ready" ? "wide" : "narrow"}>
      {id === null ? (
        <Narrow className="space-y-8">
          {!recording && (
            <>
              <Labelled label="Type">
                <Choice variant="chips" label="Meeting type" options={MEETING_TYPES} value={type} onChange={setType} />
              </Labelled>
              <Labelled label="Student" optional htmlFor="meeting-student" className="max-w-sm">
                <StudentPicker id="meeting-student" value={studentId} onChange={setStudentId} />
              </Labelled>
            </>
          )}
          <div className="pt-2">
            {busy ? (
              <JobProgress label="Uploading…" progress={null} />
            ) : mode === "record" ? (
              <ConsentRecorder onRecorded={(b) => sendAudio(b, b.type.includes("mp4") ? "meeting.m4a" : "meeting.webm")} onPhase={(p) => setRecording(p === "recording")} footer={links} />
            ) : (
              <div className="animate-fadein space-y-4">
                <textarea
                  className="input"
                  rows={8}
                  autoFocus
                  aria-label="Transcript"
                  placeholder="Paste the transcript here"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-primary" disabled={!pasted.trim()} onClick={sendTranscript}>
                    Make notes
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setMode("record")}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          {failure && <ErrorLine>{failure}</ErrorLine>}
        </Narrow>
      ) : error ? (
        <Narrow>
          <p className="text-base text-muted">
            This meeting isn't available.{" "}
            <Link to="/tools/meeting" className="link">
              Start a new one
            </Link>
          </p>
        </Narrow>
      ) : !draft ? (
        <Narrow>
          <SkeletonText lines={4} />
        </Narrow>
      ) : isWorking(draft.status) ? (
        <Narrow>
          <JobProgress
            label={draft.transcript?.length ? "Writing notes…" : "Transcribing…"}
            progress={draft.progress}
            note="You can leave this page. The notes will be under Recent."
          />
        </Narrow>
      ) : draft.status === "error" ? (
        <Narrow className="space-y-4">
          <ErrorLine>{draft.error || "Something went wrong with this recording."}</ErrorLine>
          <Link to="/tools/meeting" className="btn-secondary">
            Start over
          </Link>
        </Narrow>
      ) : (
        <NotesView draft={draft} onApproved={setDraft} />
      )}

      {!recording && (
        <Narrow>
          <DraftList tool="meeting" activeId={id} refreshKey={draft?.status} />
        </Narrow>
      )}
    </ToolPage>
  );
}

/* ---------- Notes ---------- */

const SECTION_LABELS: Record<string, string> = {
  decisions: "Decisions",
  services_discussed: "Services discussed",
  concerns: "Concerns",
  strengths: "Strengths",
  next_steps: "Next steps",
  action_items: "Action items",
};
const ORDER = ["decisions", "services_discussed", "concerns", "strengths", "next_steps", "action_items"];
const titleFor = (k: string) => SECTION_LABELS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function sectionKeys(n: Notes): string[] {
  const lists = Object.keys(n).filter((k) => Array.isArray(n[k]) && k !== "summary_refs");
  return [...ORDER.filter((k) => lists.includes(k)), ...lists.filter((k) => !ORDER.includes(k))];
}

function notesText(n: Notes): string {
  const out = ["Summary", n.summary, ""];
  for (const k of sectionKeys(n)) {
    out.push(titleFor(k));
    for (const it of n[k] as (NoteItem | ActionItem)[]) {
      if ("task" in it) out.push(`- ${it.task}${it.owner ? ` (${it.owner}${it.due ? `, due ${it.due}` : ""})` : ""}`);
      else out.push(`- ${it.text}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

function NotesView({ draft, onApproved }: { draft: Draft<"meeting">; onApproved: (d: Draft<"meeting">) => void }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  const segments: Segment[] = draft.transcript ?? [];
  const [focus, setFocus] = useState<TranscriptFocus | null>(null);
  const [approving, setApproving] = useState(false);
  const [failure, setFailure] = useState("");
  const recorded = !draft.input?.transcript;
  const jump = (index: number) => setFocus((f) => ({ index, n: (f?.n ?? 0) + 1 }));

  if (!output) return null;
  const set = (patch: Partial<Notes>) => setOutput({ ...output, ...patch });
  const setItem = (key: string, i: number, patch: Partial<NoteItem & ActionItem>) =>
    set({ [key]: (output[key] as object[]).map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const removeItem = (key: string, i: number) => set({ [key]: (output[key] as object[]).filter((_, j) => j !== i) });
  const addItem = (key: string) =>
    set({ [key]: [...(output[key] as object[]), key === "action_items" ? { task: "", owner: "", due: "" } : { text: "" }] });

  const approve = async () => {
    setApproving(true);
    setFailure("");
    try {
      await tools.save<"meeting">(draft.id, output);
      onApproved(await tools.approve(draft.id));
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="grid animate-fade-in gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
      <OutputEditor
        label="Notes"
        saved={saved}
        actions={<CopyButton text={() => notesText(output)} label="Copy all" />}
        className="min-w-0"
      >
        {draft.title && <p className="-mt-2 mb-8 text-sm text-faint">{draft.title}</p>}
        <div className="space-y-10">
          <div>
            <h3 className="mb-2 text-base font-medium">Summary</h3>
            <EditableText label="Summary" value={output.summary ?? ""} onChange={(summary) => set({ summary })} />
            <RefChips refs={output.summary_refs} segments={segments} onJump={jump} />
          </div>

          {sectionKeys(output).map((key) => (
            <div key={key}>
              <h3 className="mb-2 text-base font-medium">{titleFor(key)}</h3>
              <ul className="space-y-3">
                {(output[key] as (NoteItem | ActionItem)[]).map((it, i) => (
                  <li key={i} className="group relative pr-8">
                    {key === "action_items" ? (
                      <ActionRow item={it as ActionItem} onChange={(p) => setItem(key, i, p)}>
                        <RefChips refs={it.refs} segments={segments} onJump={jump} className="" />
                      </ActionRow>
                    ) : (
                      <>
                        <EditableText label={titleFor(key)} value={(it as NoteItem).text ?? ""} onChange={(text) => setItem(key, i, { text })} />
                        <RefChips refs={it.refs} segments={segments} onJump={jump} />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(key, i)}
                      aria-label="Remove"
                      className="btn-ghost btn-icon btn-sm absolute right-0 top-0.5 text-faint opacity-0 transition-opacity focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {key === "action_items" && (
                <button type="button" className="btn-link mt-3 font-normal" onClick={() => addItem(key)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add
                </button>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-8">
            {draft.approved_at ? (
              <p className="flex animate-fade-in items-center gap-2 text-sm text-muted">
                <Check className="h-4 w-4 text-success" aria-hidden />
                {recorded ? "Approved. The recording was deleted." : "Approved."}
              </p>
            ) : (
              <>
                <button type="button" className="btn-primary" onClick={approve} disabled={approving}>
                  Approve
                </button>
                {recorded && <p className="text-sm text-faint">Approving deletes the recording. The transcript and notes are kept.</p>}
              </>
            )}
            {failure && <ErrorLine>{failure}</ErrorLine>}
          </div>
        </div>
      </OutputEditor>

      {segments.length > 0 && (
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <h2 className="label mb-4 flex min-h-7 items-center justify-between">
            Transcript
            <span className="tnum normal-case tracking-normal">{clock(segments[segments.length - 1]!.end)}</span>
          </h2>
          <div className="-mx-2 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
            <TranscriptView segments={segments} focus={focus} onFocus={jump} />
          </div>
        </aside>
      )}
    </div>
  );
}

function ActionRow({ item, onChange, children }: { item: ActionItem; onChange: (p: Partial<ActionItem>) => void; children?: ReactNode }) {
  return (
    <div>
      <EditableText label="Action item" value={item.task ?? ""} onChange={(task) => onChange({ task })} />
      <div className="mt-0.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Meta label="Owner" value={item.owner ?? ""} onChange={(owner) => onChange({ owner })} placeholder="Who" />
        <Meta label="Due" value={item.due ?? ""} onChange={(due) => onChange({ due })} placeholder="When" />
        {children}
      </div>
    </div>
  );
}

function Meta({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-faint">{label}</span>
      <span className="w-[7.5rem]">
        <EditableText single label={label} value={value} onChange={onChange} placeholder={placeholder} className="text-sm leading-[22px] text-muted" />
      </span>
    </span>
  );
}
