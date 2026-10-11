import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square } from "lucide-react";
import { clock } from "./TranscriptView";
import { isDesktop } from "../../lib/shell";
import { callAudio } from "../../lib/native";
import { NotepadField, NotepadHint, useNotepad } from "./Notepad";
import { ErrorLine } from "./ToolPage";

export type RecorderPhase = "idle" | "consent" | "starting" | "recording" | "stopping" | "denied" | "unsupported";
type Phase = RecorderPhase;

export interface Recording {
  id: number;
  mic: Blob;
  /** The computer's sound (Mac app), or null. */
  call: Blob | null;
  seconds: number;
}

/**
 * Record a meeting. Nothing is captured until the teacher confirms that everyone agreed. Start
 * makes the meeting right away (`onStart` returns its id) so the notepad below the recording bar
 * can save as the teacher types. In the Mac app the computer's sound is recorded too.
 */
export function ConsentRecorder({
  onStart,
  onRecorded,
  onPhase,
  footer,
}: {
  /** Create the meeting; resolves with its id. */
  onStart: () => Promise<number>;
  onRecorded: (r: Recording) => void;
  /** Lets the page hide its other inputs while recording. */
  onPhase?: (p: Phase) => void;
  /** Small secondary links under the button ("Upload a recording"…). Hidden while recording. */
  footer?: ReactNode;
}) {
  const [phase, setPhaseState] = useState<Phase>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia ? "unsupported" : "idle",
  );
  const [agreed, setAgreed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [withCall, setWithCall] = useState(false);
  const [micOnly, setMicOnly] = useState("");
  const [failure, setFailure] = useState("");
  const notes = useNotepad(draftId);
  const level = useRef<HTMLSpanElement>(null);
  const rec = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    ctx: AudioContext | null;
    raf: number;
    tick: number;
    started: number;
    chunks: Blob[];
  } | null>(null);

  const setPhase = (p: Phase) => {
    setPhaseState(p);
    onPhase?.(p);
  };

  const teardown = () => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    window.clearInterval(r.tick);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => undefined);
    rec.current = null;
  };
  const callOn = useRef(false);
  useEffect(
    () => () => {
      teardown();
      if (callOn.current) void callAudio.stop(); // leaving the page mid-recording
    },
    [],
  );

  // Leaving mid-recording would lose the meeting: ask the browser to confirm.
  useEffect(() => {
    if (phase !== "recording" && phase !== "stopping") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const start = async () => {
    setPhase("starting");
    setFailure("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setPhase("denied");
      return;
    }
    let id: number;
    try {
      id = await onStart();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      setFailure((e as Error).message);
      setPhase("consent");
      return;
    }
    let call = false;
    let reason = "";
    if (await callAudio.available()) {
      try {
        await callAudio.start();
        call = true;
      } catch (e) {
        reason = (e as Error).message;
      }
    }
    setDraftId(id);
    setWithCall(call);
    callOn.current = call;
    setMicOnly(reason);
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);

    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (level.current) level.current.style.transform = `scaleX(${Math.max(0.04, rms)})`;
        if (rec.current) rec.current.raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    } catch {
      ctx = null; // level meter is a nicety
    }
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    rec.current = { stream, recorder, ctx, raf, tick, started, chunks };
    setElapsed(0);
    setPhase("recording");
  };

  const stop = () => {
    const r = rec.current;
    if (!r || phase !== "recording") return;
    setPhase("stopping");
    const seconds = (Date.now() - r.started) / 1000;
    const id = draftId!;
    r.recorder.onstop = async () => {
      const mic = new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" });
      teardown();
      callOn.current = false;
      const [call] = await Promise.all([withCall ? callAudio.stop() : Promise.resolve(null), notes.flush()]);
      setPhase("idle");
      setAgreed(false);
      setDraftId(null);
      onRecorded({ id, mic, call, seconds });
    };
    r.recorder.stop();
  };

  if (phase === "recording" || phase === "stopping")
    return (
      <div className="animate-fadein">
        <div
          role="status"
          aria-label={`Recording, ${clock(elapsed)}`}
          className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-line bg-bg px-4 py-3 sm:mx-0 sm:gap-4 sm:px-0"
        >
          <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 animate-pulse-soft rounded-full bg-danger" />
          </span>
          <span className="tnum font-mono text-sm text-ink">{clock(elapsed)}</span>
          <span aria-hidden className="block h-1 w-12 shrink-0 overflow-hidden rounded-full bg-ink/[0.08] sm:w-20">
            <span ref={level} className="block h-full w-full origin-left bg-ink/50 transition-transform duration-instant" style={{ transform: "scaleX(0.04)" }} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            <span className="sm:hidden">{withCall ? "Mic + call" : "Mic"}</span>
            <span className="hidden sm:inline">{withCall ? "Microphone + call audio" : "Microphone"}</span>
          </span>
          <span className="hidden sm:inline">
            <NotepadHint state={notes.state} />
          </span>
          <button type="button" onClick={stop} disabled={phase === "stopping"} className="btn-primary btn-sm shrink-0">
            <Square className="h-3 w-3 fill-current" aria-hidden />
            Stop
          </button>
        </div>
        <p className="mt-2 h-4 text-right sm:hidden">
          <NotepadHint state={notes.state} />
        </p>
        {micOnly && <p className="mt-3 text-sm text-faint">Recording your microphone only — {micOnly}</p>}
        <NotepadField value={notes.text} onChange={notes.setText} autoFocus className="mt-4 min-h-[50vh] sm:mt-8" />
      </div>
    );

  if (phase === "consent" || phase === "starting")
    return (
      <div className="animate-fadein rounded border border-line bg-panel p-5 sm:p-6">
        <label className="flex cursor-pointer items-start gap-3 text-base text-ink">
          <input type="checkbox" className="checkbox mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} autoFocus />
          Everyone in this meeting has agreed to be recorded
        </label>
        <div className="mt-6 flex items-center gap-2">
          <button type="button" className="btn-primary" disabled={!agreed || phase === "starting"} onClick={start}>
            <Mic className="h-4 w-4" aria-hidden />
            Start
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPhase("idle")}>
            Cancel
          </button>
        </div>
        {failure && (
          <div className="mt-4">
            <ErrorLine>{failure}</ErrorLine>
          </div>
        )}
      </div>
    );

  return (
    <div className="animate-fadein">
      {phase === "unsupported" ? (
        <p className="text-base text-muted">
          {isDesktop
            ? "Recording isn't available in this version of the app. Choose Teacher's Desk → Check for Updates…, or upload a recording or paste a transcript instead."
            : "This browser can't record. Upload a recording or paste a transcript instead."}
        </p>
      ) : (
        <button type="button" className="btn-primary btn-lg w-full sm:w-auto" onClick={() => setPhase("consent")}>
          <Mic className="h-4 w-4" aria-hidden />
          Start recording
        </button>
      )}
      {phase === "denied" && (
        <p role="alert" className="mt-4 animate-fadein text-sm text-muted">
          The microphone is blocked. Allow it in your browser's site settings, then{" "}
          <button type="button" className="btn-link" onClick={() => setPhase("consent")}>
            try again
          </button>
          .
        </p>
      )}
      {footer && <div className="mt-5">{footer}</div>}
    </div>
  );
}
