import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square } from "lucide-react";
import { clock } from "./TranscriptView";
import { desktopVersion, isDesktop, isNewer } from "../../lib/shell";
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
      <div className="animate-fade-in">
        <div className="flex h-5 items-center justify-between gap-3">
          {micOnly ? <p className="truncate text-sm text-faint">Recording your microphone only — {micOnly}</p> : <span />}
          <NotepadHint state={notes.state} />
        </div>
        {/* The page is the notepad. */}
        <NotepadField
          value={notes.text}
          onChange={notes.setText}
          autoFocus
          placeholder="Type notes as you go — or don't. The recording fills in the rest."
          className="mt-3 min-h-[55vh] text-lg leading-[30px]"
        />
        {/* Floating recorder pill, like the notes page's ask bar. */}
        <div className="sticky bottom-0 z-30 flex justify-center bg-gradient-to-t from-bg from-60% to-transparent pb-5 pt-8">
          <div
            role="status"
            aria-label={`Recording, ${clock(elapsed)}`}
            className="flex h-12 animate-slide-up items-center gap-3 rounded-full border border-ink/[0.07] bg-panel pl-4 pr-1.5 shadow-lg sm:gap-4"
          >
            <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inset-0 animate-pulse-soft rounded-full bg-danger" />
            </span>
            <span className="tnum font-mono text-sm text-ink">{clock(elapsed)}</span>
            <span aria-hidden className="block h-1 w-12 shrink-0 overflow-hidden rounded-full bg-ink/[0.08] sm:w-16">
              <span ref={level} className="block h-full w-full origin-left bg-danger/70 transition-transform duration-instant" style={{ transform: "scaleX(0.04)" }} />
            </span>
            <span className="hidden text-sm text-muted sm:inline">{withCall ? "Mic + call audio" : "Microphone"}</span>
            <button type="button" onClick={stop} disabled={phase === "stopping"} className="btn-primary btn-sm h-9 shrink-0 rounded-full px-4">
              <Square className="h-3 w-3 fill-current" aria-hidden />
              {phase === "stopping" ? "Stopping…" : "Stop"}
            </button>
          </div>
        </div>
      </div>
    );

  if (phase === "consent" || phase === "starting")
    return (
      <div className="animate-fade-in rounded bg-ink/[0.04] p-5 sm:p-6">
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
    <div className="animate-fade-in">
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
        <p role="alert" className="mt-4 max-w-prose animate-fade-in text-sm text-muted">
          {isDesktop ? (
            <>
              The microphone is blocked. Open System Settings → Privacy &amp; Security → Microphone, turn on Teacher's
              Desk, then quit and reopen the app.{" "}
              {/* Apps from 0.5.2 open that settings page for this link. */}
              {isNewer(desktopVersion || "0", "0.5.1") && (
                <>
                  <a className="btn-link" href="teachersdesk://mic-settings">
                    Open Microphone settings
                  </a>
                  {" · "}
                </>
              )}
              <button type="button" className="btn-link" onClick={() => setPhase("consent")}>
                Try again
              </button>
            </>
          ) : (
            <>
              The microphone is blocked. Allow it in your browser's site settings, then{" "}
              <button type="button" className="btn-link" onClick={() => setPhase("consent")}>
                try again
              </button>
              .
            </>
          )}
        </p>
      )}
      {footer && <div className="mt-5">{footer}</div>}
    </div>
  );
}
