import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, FileAudio, Plus, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { ConsentRecorder } from "../../components/tools/ConsentRecorder";
import { DraftProgress, JobProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { CopyButton, EditableText, WordButton, OutputEditor, useDraftOutput } from "../../components/tools/OutputEditor";
import { RefChips, TranscriptView, clock, type TranscriptFocus } from "../../components/tools/TranscriptView";
import { DraftList } from "../../components/tools/DraftList";
import { formatBytes } from "../../lib/api";
import {
  isWorking,
  loadMeta,
  tools,
  useToolsMeta,
  type ActionItem,
  type Draft,
  type MeetingNotes as Notes,
  type MeetingType,
  type NoteItem,
  type NoteSection,
} from "../../lib/tools";

const AUDIO = ".webm,.ogg,.m4a,.mp3,.wav,audio/*";

/** Create nothing until there is something to send; then upload with progress. */
function useSend(onDone: (d: Draft<"meeting">) => void) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [failure, setFailure] = useState("");

  const upload = async (id: number, audio: Blob, filename: string) => {
    const meta = await loadMeta().catch(() => null);
    setUploading(0);
    try {
      return await tools.uploadAudio(id, audio, { filename, chunkBytes: meta?.audio.chunk_bytes, onProgress: setUploading });
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
  return { uploading, failure, setFailure, upload, run };
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

  const links = (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <button type="button" className="btn-link font-normal" onClick={() => picker.current?.click()}>
        Upload a recording
      </button>
      <button type="button" className="btn-link font-normal" onClick={() => setMode("paste")}>
        Paste a transcript
      </button>
    </div>
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
              <ConsentRecorder onRecorded={(b) => sendAudio(b)} onPhase={(p) => setRecording(p === "recording")} footer={links} />
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
        <NotesView draft={draft} sections={draft.sections ?? meta?.meeting_types.find((t) => t.key === draft.meeting_type)?.sections ?? []} onApproved={setDraft} />
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

function NotesView({ draft, sections, onApproved }: { draft: Draft<"meeting">; sections: NoteSection[]; onApproved: (d: Draft<"meeting">) => void }) {
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
                        <ActionRow item={it} onChange={(p) => setItem(s.key, i, p)}>
                          <RefChips refs={it.refs} segments={segments} onJump={jump} className="" />
                        </ActionRow>
                      ) : (
                        <>
                          <EditableText label={s.title} value={it.text} onChange={(text) => setItem(s.key, i, { text })} />
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

function ActionRow({ item, onChange, children }: { item: ActionItem; onChange: (p: Partial<ActionItem>) => void; children?: ReactNode }) {
  return (
    <div>
      <EditableText label="Action item" value={item.task} onChange={(task) => onChange({ task })} placeholder="What needs doing" />
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
