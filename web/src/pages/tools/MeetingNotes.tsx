import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { FileAudio, X } from "lucide-react";
import { SkeletonText } from "../../components/ui";
import { ToolPage, Narrow, Choice, Labelled, ErrorLine } from "../../components/tools/ToolPage";
import { StudentPicker } from "../../components/tools/StudentPicker";
import { ConsentRecorder, type Recording } from "../../components/tools/ConsentRecorder";
import { DraftProgress, JobProgress, RetryButton, useDraft } from "../../components/tools/JobProgress";
import { DraftList } from "../../components/tools/DraftList";
import { MeetingDoc } from "../../components/tools/meeting/MeetingDoc";
import { formatBytes } from "../../lib/api";
import { useHealth } from "../../components/shell/health";
import {
  isWorking,
  loadMeta,
  tools,
  useToolsMeta,
  type AudioTrack,
  type Draft,
  type MeetingType,
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

  // A finished meeting reads like a document: its own header, no tool chrome.
  if (id !== null && draft && !error && send.uploading === null && draft.status === "ready") {
    const t = meta?.meeting_types.find((x) => x.key === draft.meeting_type);
    return (
      <MeetingDoc
        draft={draft}
        sections={draft.sections ?? t?.sections ?? []}
        typeLabel={t?.label}
        onApproved={setDraft}
        onRestart={restart}
      />
    );
  }

  return (
    <ToolPage title="Meeting">
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
              <div className="animate-fade-in rounded bg-ink/[0.04] p-5 sm:p-6">
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
              <div className="animate-fade-in space-y-4">
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
      ) : null}

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
    <div className="flex animate-fade-in items-center gap-3 rounded bg-ink/[0.04] py-2 pl-3 pr-1.5 text-sm">
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
