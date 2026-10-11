import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronRight, FileAudio, Plus, X } from "lucide-react";
import clsx from "clsx";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { ConsentRecorder, type Recording } from "../../components/tools/ConsentRecorder";
import { NotepadField, NotepadHint, useNotepad } from "../../components/tools/Notepad";
import { DraftProgress, JobProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, WordButton, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { RefChips, TranscriptView, clock, type TranscriptFocus } from "../../components/tools/TranscriptView";
import { DraftList } from "../../components/tools/DraftList";
import { formatBytes } from "../../lib/api";
import { useHealth } from "../../components/shell/health";
import {
  isWorking,
  loadMeta,
  tools,
  useToolsMeta,
  type ActionItem,
  type AudioTrack,
  type Draft,
  type MeetingNotes as Notes,
  type MeetingType,
  type NoteItem,
  type NoteSection,
  type Segment,
} from "../../lib/tools";

const AUDIO = ".webm,.ogg,.m4a,.mp3,.wav,audio/*";

/** Create nothing until there is something to send; then upload with progress. */
function useSend(onDone: (d: Draft<"meeting">) => void) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [failure, setFailure] = useState("");

  const upload = (id: number, audio: Blob, filename: string) => uploadAll(id, [{ audio, filename }]);

  /** Upload several tracks in order (call audio first, the microphone last: it queues the notes). */
  const uploadAll = async (id: number, parts: { audio: Blob; filename: string; track?: AudioTrack; optional?: boolean }[]) => {
    const meta = await loadMeta().catch(() => null);
    const total = parts.reduce((n, p) => n + p.audio.size, 0) || 1;
    let before = 0;
    let last: Draft<"meeting"> | null = null;
    setUploading(0);
    try {
      for (const p of parts) {
        const base = before;
        try {
          last = await tools.uploadAudio(id, p.audio, {
            filename: p.filename,
            track: p.track,
            chunkBytes: meta?.audio.chunk_bytes,
            onProgress: (f) => setUploading((base + f * p.audio.size) / total),
          });
        } catch (e) {
          if (!p.optional) throw e; // the call audio is a bonus; the microphone is the meeting
        }
        before += p.audio.size;
      }
      return last!;
    } finally {
      setUploading(null);
    }
  };

  const run = async (go: () => Promise<Draft<"meeting">>, then = onDone) => {
    setFailure("");
    try {
      then(await go());
    } catch (e) {
      setUploading(null);
      setFailure((e as Error).message);
    }
  };
  return { uploading, failure, setFailure, upload, uploadAll, run };
}

const audioName = (b: Blob) => (b instanceof File ? b.name : b.type.includes("mp4") ? "meeting.m4a" : b.type.includes("ogg") ? "meeting.ogg" : "meeting.webm");

export function MeetingNotes() {
  const { draftId } = useParams();
  const id = draftId ? Number(draftId) : null;
  const navigate = useNavigate();
  const initial = (useLocation().state as { draft?: Draft<"meeting"> } | null)?.draft ?? null;
  const { draft, setDraft, restart, error } = useDraft<"meeting">(id, initial);
  const meta = useToolsMeta();

  const [type, setType] = useState<MeetingType>("iep");
  const [studentId, setStudentId] = useState<number | null>(null);
  const [mode, setMode] = useState<"record" | "paste" | "file">("record");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [creating, setCreating] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const open = (d: Draft<"meeting">) => {
    // The next meeting starts fresh; the type and student stay as they were.
    setPasted("");
    setFile(null);
    setMode("record");
    navigate(`/tools/meeting/${d.id}`, { state: { draft: d } });
  };
  const send = useSend(open);

  const sendAudio = (audio: Blob) =>
    send.run(async () => {
      const { draft: d } = await tools.create("meeting", { meeting_type: type, student_id: studentId, consent: true });
      return send.upload(d.id, audio, audioName(audio));
    });

  const startRecording = async () => {
    send.setFailure("");
    const { draft: d } = await tools.create("meeting", { meeting_type: type, student_id: studentId, consent: true });
    return d.id;
  };

  const sendRecording = ({ id: draftId, mic, call }: Recording) =>
    send.run(() =>
      send.uploadAll(draftId, [
        ...(call ? [{ audio: call, filename: "meeting-call.m4a", track: "call" as const, optional: true }] : []),
        { audio: mic, filename: audioName(mic) },
      ]),
    );

  const sendTranscript = () =>
    send.run(async () => {
      setCreating(true);
      try {
        return (await tools.create("meeting", { meeting_type: type, student_id: studentId, transcript_text: pasted.trim() })).draft;
      } finally {
        setCreating(false);
      }
    });

  const choose = (
    <input
      ref={picker}
      type="file"
      accept={AUDIO}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setFile(f);
        setAgreed(false);
        setMode("file");
      }}
    />
  );

  const local = useHealth()?.local;
  const links = (
    <>
    {local && (
      <p className="mb-4 max-w-prose text-sm text-muted">
        Recordings and notes stay on this Mac. To transcribe and write the notes, the audio and transcript pass through
        your school's AI for a moment and aren't kept there.{" "}
        <Link to="/privacy" className="btn-link font-normal">Privacy</Link>
      </p>
    )}
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <button type="button" className="btn-link font-normal" onClick={() => picker.current?.click()}>
        Upload a recording
      </button>
      <button type="button" className="btn-link font-normal" onClick={() => setMode("paste")}>
        Paste a transcript
      </button>
    </div>
    </>
  );

  const types = meta?.meeting_types.map((t) => ({ value: t.key, label: t.label })) ?? [];

  return (
    <ToolPage title="Meeting" width={id !== null && draft?.status === "ready" ? "wide" : "narrow"}>
      {choose}
      {id === null ? (
        <Narrow className="space-y-8">
          {!recording && send.uploading === null && (
            <>
              <Labelled label="Type">
                {types.length ? (
                  <Choice variant="chips" label="Meeting type" options={types} value={type} onChange={setType} />
                ) : (
                  <div className="h-8" />
                )}
              </Labelled>
              <Labelled label="Student" optional htmlFor="meeting-student" className="max-w-sm">
                <StudentPicker id="meeting-student" value={studentId} onChange={setStudentId} />
              </Labelled>
            </>
          )}
          <div className="pt-2">
            {send.uploading !== null ? (
              <JobProgress label="Uploading…" progress={send.uploading} note="Keep this page open until the upload finishes." />
            ) : mode === "record" ? (
              <ConsentRecorder
                onStart={startRecording}
                onRecorded={sendRecording}
                onPhase={(p) => setRecording(p === "recording" || p === "stopping")}
                footer={links}
              />
            ) : mode === "file" && file ? (
              <div className="animate-fadein rounded border border-line bg-panel p-5 sm:p-6">
                <p className="flex items-center gap-3 text-sm">
                  <FileAudio className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
                  <span className="tnum shrink-0 text-xs text-faint">{formatBytes(file.size)}</span>
                </p>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-base text-ink">
                  <input type="checkbox" className="checkbox mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  Everyone in this recording agreed to be recorded
                </label>
                <div className="mt-6 flex items-center gap-2">
                  <button type="button" className="btn-primary" disabled={!agreed} onClick={() => sendAudio(file)}>
                    Make notes
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setMode("record")}>
                    Cancel
                  </button>
                </div>
              </div>
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
                  <button type="button" className="btn-primary" disabled={!pasted.trim() || creating} onClick={sendTranscript}>
                    {creating ? "Starting…" : "Make notes"}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setMode("record")}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          {send.failure && <ErrorLine>{send.failure}</ErrorLine>}
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
      ) : send.uploading !== null ? (
        <Narrow>
          <JobProgress label="Uploading…" progress={send.uploading} note="Keep this page open until the upload finishes." />
        </Narrow>
      ) : draft.status === "awaiting_audio" ? (
        <Narrow className="space-y-5">
          <p className="text-base text-muted">The recording didn't finish uploading.</p>
          <button type="button" className="btn-primary" onClick={() => picker.current?.click()}>
            Upload the recording
          </button>
          {file && mode === "file" && (
            <ResumeUpload
              file={file}
              onCancel={() => setMode("record")}
              onSend={() =>
                send.run(
                  () => send.upload(draft.id, file, file.name),
                  (d) => {
                    setMode("record");
                    restart(d);
                  },
                )
              }
            />
          )}
          {send.failure && <ErrorLine>{send.failure}</ErrorLine>}
        </Narrow>
      ) : isWorking(draft.status) ? (
        <Narrow>
          <DraftProgress draft={draft} note="You can leave this page. The notes will be under Recent." />
        </Narrow>
      ) : draft.status === "error" ? (
        <Narrow className="space-y-5">
          <ErrorLine>{draft.error || "Something went wrong with this meeting."}</ErrorLine>
          {draft.transcript || draft.has_audio ? (
            <RetryButton id={draft.id} onRetry={restart} />
          ) : (
            <Link to="/tools/meeting" className="btn-secondary">
              Start over
            </Link>
          )}
        </Narrow>
      ) : (
        <NotesView
          draft={draft}
          sections={draft.sections ?? meta?.meeting_types.find((t) => t.key === draft.meeting_type)?.sections ?? []}
          onApproved={setDraft}
          onRestart={restart}
        />
      )}

      {!recording && send.uploading === null && (
        <Narrow>
          <DraftList tool="meeting" activeId={id} refreshKey={draft?.status} />
        </Narrow>
      )}
    </ToolPage>
  );
}

function ResumeUpload({ file, onSend, onCancel }: { file: File; onSend: () => void; onCancel: () => void }) {
  return (
    <div className="flex animate-fadein items-center gap-3 rounded border border-line bg-panel py-2 pl-3 pr-1.5 text-sm">
      <FileAudio className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <button type="button" className="btn-primary btn-sm" onClick={onSend}>
        Upload
      </button>
      <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label="Cancel" onClick={onCancel}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/* ---------- Notes ---------- */

const isAction = (it: NoteItem | ActionItem): it is ActionItem => "task" in it;

function notesText(n: Notes, sections: NoteSection[]): string {
  const out: string[] = [];
  for (const s of sections) {
    if (s.kind === "text") {
      if (n[s.key]) out.push(s.title, String(n[s.key]), "");
      continue;
    }
    const items = (n[s.key] as (NoteItem | ActionItem)[] | undefined) ?? [];
    if (!items.length) continue;
    out.push(s.title);
    for (const it of items) {
      if (isAction(it)) out.push(`- ${it.task}${it.owner || it.due ? ` (${[it.owner, it.due && `by ${it.due}`].filter(Boolean).join(", ")})` : ""}`);
      else out.push(`- ${it.text}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

function NotesView({
  draft,
  sections,
  onApproved,
  onRestart,
}: {
  draft: Draft<"meeting">;
  sections: NoteSection[];
  onApproved: (d: Draft<"meeting">) => void;
  onRestart: (d: Draft<"meeting">) => void;
}) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  const segments = draft.transcript ?? [];
  const [focus, setFocus] = useState<TranscriptFocus | null>(null);
  const [approving, setApproving] = useState(false);
  const [failure, setFailure] = useState("");
  const recorded = draft.source === "audio";
  const jump = (index: number) => setFocus((f) => ({ index, n: (f?.n ?? 0) + 1 }));

  if (!output) return null;
  const list = (key: string) => (output[key] as (NoteItem | ActionItem)[] | undefined) ?? [];
  const set = (patch: Partial<Notes>) => setOutput({ ...output, ...patch });
  const setItem = (key: string, i: number, patch: Partial<NoteItem & ActionItem>) =>
    set({ [key]: list(key).map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const removeItem = (key: string, i: number) => set({ [key]: list(key).filter((_, j) => j !== i) });
  const addAction = () => set({ action_items: [...output.action_items, { task: "", owner: "", due: null, refs: [] }] });

  const approve = async () => {
    setApproving(true);
    setFailure("");
    try {
      // Blank lines the teacher added but never filled are dropped rather than refused.
      const clean = { ...output, action_items: output.action_items.filter((a) => a.task.trim()) };
      await tools.save<"meeting">(draft.id, clean);
      onApproved(await tools.approve<"meeting">(draft.id));
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setApproving(false);
    }
  };

  const last = segments[segments.length - 1];
  // Gray marks what the recording added to the teacher's own notes, so it only means something
  // when the teacher wrote notes.
  const all = sections.filter((s) => s.kind !== "text").flatMap((s) => list(s.key));
  const legend = Boolean(output.my_notes?.trim()) || (all.some((it) => it.mine === true) && all.some((it) => it.mine === false));
  const gray = (it: NoteItem | ActionItem) => legend && it.mine === false;
  const notepad = String(draft.input?.my_notes ?? output.my_notes ?? "");
  // Empty sections stay out of the way; action items always show so one can be added.
  const shown = sections.filter((s) => s.kind !== "items" || list(s.key).length > 0);

  return (
    <div className="grid animate-fade-in gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
      <OutputEditor label={draft.title || "Notes"} saved={saved} actions={
        <span className="flex items-center gap-2">
          <CopyButton text={() => notesText(output, sections)} />
          <WordButton title={draft.title || "Meeting notes"} text={() => notesText(output, sections)} />
        </span>
      } className="min-w-0">
        {legend && <p className="-mt-2 mb-8 text-xs text-faint">Gray = added from the recording</p>}
        <div className="space-y-10">
          {shown.map((s) => (
            <div key={s.key}>
              <h3 className="mb-2 text-base font-medium">{s.title}</h3>
              {s.kind === "text" ? (
                <EditableText label={s.title} value={String(output[s.key] ?? "")} onChange={(v) => set({ [s.key]: v })} />
              ) : (
                <ul className="space-y-3">
                  {list(s.key).map((it, i) => (
                    <li key={i} className="group relative pr-8">
                      {isAction(it) ? (
                        <ActionRow item={it} gray={gray(it)} onChange={(p) => setItem(s.key, i, p)}>
                          <RefChips refs={it.refs} segments={segments} onJump={jump} className="" />
                        </ActionRow>
                      ) : (
                        <>
                          <EditableText
                            label={s.title}
                            value={it.text}
                            onChange={(text) => setItem(s.key, i, { text })}
                            tone={gray(it) ? "faint" : "ink"}
                          />
                          <RefChips refs={it.refs} segments={segments} onJump={jump} />
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(s.key, i)}
                        aria-label="Remove"
                        className="btn-ghost btn-icon btn-sm absolute right-0 top-0.5 text-faint opacity-100 transition-opacity focus:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {s.kind === "actions" && (
                <button type="button" className="btn-link mt-3 font-normal" onClick={addAction}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add
                </button>
              )}
            </div>
          ))}

          {recorded && (
            <YourNotes
              id={draft.id}
              initial={notepad}
              usedText={output.my_notes ?? notepad}
              canUpdate={!draft.approved_at && segments.length > 0}
              onRestart={onRestart}
            />
          )}

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
                {recorded && draft.has_audio && <p className="text-sm text-faint">Approving deletes the recording. The transcript and notes are kept.</p>}
              </>
            )}
            {failure && <ErrorLine>{failure}</ErrorLine>}
          </div>

          <MeetingAsk id={draft.id} segments={segments} onJump={jump} />
        </div>
      </OutputEditor>

      {segments.length > 0 && (
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <h2 className="label mb-4 flex min-h-7 items-center justify-between">
            Transcript
            {last?.end != null && <span className="tnum normal-case tracking-normal">{clock(last.end)}</span>}
          </h2>
          <div className="-mx-2 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
            <TranscriptView segments={segments} focus={focus} onFocus={jump} />
          </div>
        </aside>
      )}
    </div>
  );
}

function ActionRow({ item, gray, onChange, children }: { item: ActionItem; gray?: boolean; onChange: (p: Partial<ActionItem>) => void; children?: ReactNode }) {
  return (
    <div>
      <EditableText
        label="Action item"
        value={item.task}
        onChange={(task) => onChange({ task })}
        placeholder="What needs doing"
        tone={gray ? "faint" : "ink"}
      />
      <div className="mt-0.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Meta label="Who" value={item.owner} onChange={(owner) => onChange({ owner })} placeholder="Someone" />
        <Meta label="By" value={item.due ?? ""} onChange={(due) => onChange({ due: due.trim() ? due : null })} placeholder="Any time" />
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

/* ---------- The teacher's own notes, after the fact ---------- */

function YourNotes({
  id,
  initial,
  usedText,
  canUpdate,
  onRestart,
}: {
  id: number;
  initial: string;
  /** The notepad the current notes were written from. */
  usedText: string;
  canUpdate: boolean;
  onRestart: (d: Draft<"meeting">) => void;
}) {
  const notes = useNotepad(id, initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const changed = notes.text.trim() !== usedText.trim();

  const update = async () => {
    setBusy(true);
    setFailure("");
    try {
      await notes.flush();
      onRestart(await tools.retry<"meeting">(id));
    } catch (e) {
      setFailure((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <button type="button" className="flex items-center gap-1.5 text-base font-medium text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight className={clsx("h-4 w-4 text-faint transition-transform duration-fast", open && "rotate-90")} aria-hidden />
          Your notes
        </button>
        {open && (
          <span className="flex items-center gap-3">
            <NotepadHint state={notes.state} />
            {!editing && (
              <button type="button" className="btn-link font-normal" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-3 animate-fade-in pl-6">
          {editing ? (
            <div className="rounded-sm border border-line bg-panel px-4 py-3">
              <NotepadField value={notes.text} onChange={notes.setText} autoFocus className="min-h-[8rem] text-base leading-[26px]" placeholder="Your notes" />
            </div>
          ) : notes.text.trim() ? (
            <p className="whitespace-pre-wrap text-base text-muted">{notes.text}</p>
          ) : (
            <p className="text-base text-faint">None</p>
          )}
        </div>
      )}
      {changed && canUpdate && (
        <div className="mt-4 space-y-3 pl-6">
          <button type="button" className="btn-secondary btn-sm" onClick={update} disabled={busy}>
            Update notes with my changes
          </button>
          {failure && <ErrorLine>{failure}</ErrorLine>}
        </div>
      )}
    </div>
  );
}

/* ---------- Ask about this meeting ---------- */

interface QA {
  question: string;
  answer: string;
  refs: number[];
  error?: boolean;
}

function MeetingAsk({ id, segments, onJump }: { id: number; segments: Segment[]; onJump: (i: number) => void }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const ready = segments.length > 0;

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy || !ready) return;
    setBusy(true);
    try {
      const r = await tools.askMeeting(id, q);
      setAsked((a) => [...a, { question: q, answer: r.answer, refs: r.refs ?? [] }]);
      setQuestion("");
    } catch (err) {
      setAsked((a) => [...a, { question: q, answer: (err as Error).message, refs: [], error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line pt-8">
      <h3 className="mb-3 text-base font-medium">Ask about this meeting</h3>
      <form onSubmit={ask} className="flex gap-2">
        <input
          className="input min-w-0 flex-1"
          aria-label="Question about this meeting"
          placeholder={ready ? "What did we decide about…" : "Available once there's a transcript"}
          maxLength={500}
          value={question}
          disabled={!ready}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn-secondary shrink-0" disabled={!ready || busy || !question.trim()}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      {asked.length > 0 && (
        <ul className="mt-6 space-y-6" aria-live="polite">
          {asked.map((qa, i) => (
            <li key={i} className="animate-fade-in">
              <p className="text-base text-ink">{qa.question}</p>
              <p className={clsx("mt-1 whitespace-pre-wrap text-base", qa.error ? "text-danger" : "text-muted")}>{qa.answer}</p>
              <RefChips refs={qa.refs} segments={segments} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
