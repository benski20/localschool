import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square } from "lucide-react";
import { clock } from "./TranscriptView";

type Phase = "idle" | "consent" | "starting" | "recording" | "denied" | "unsupported";

/**
 * Record a meeting in the browser. Nothing is captured until the teacher confirms that everyone
 * agreed; while recording a red dot, a timer and the input level stay visible, with one Stop.
 */
export function ConsentRecorder({
  onRecorded,
  onPhase,
  footer,
}: {
  onRecorded: (audio: Blob, seconds: number) => void;
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
  useEffect(() => teardown, []);

  // Leaving mid-recording would lose the meeting: ask the browser to confirm.
  useEffect(() => {
    if (phase !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const start = async () => {
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setPhase("denied");
      return;
    }
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
    if (!r) return;
    const seconds = (Date.now() - r.started) / 1000;
    r.recorder.onstop = () => {
      const blob = new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" });
      teardown();
      setPhase("idle");
      setAgreed(false);
      onRecorded(blob, seconds);
    };
    r.recorder.stop();
  };

  if (phase === "recording")
    return (
      <div
        role="status"
        aria-label={`Recording, ${clock(elapsed)}`}
        className="flex animate-fadein items-center gap-4 rounded border border-line bg-panel px-4 py-3 sm:gap-5 sm:px-5"
      >
        <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 animate-pulse-soft rounded-full bg-danger" />
        </span>
        <span className="hidden text-sm text-ink sm:inline">Recording</span>
        <span className="tnum font-mono text-sm text-muted">{clock(elapsed)}</span>
        <span aria-hidden className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
          <span ref={level} className="block h-full w-full origin-left bg-ink/50 transition-transform duration-instant" style={{ transform: "scaleX(0.04)" }} />
        </span>
        <button type="button" onClick={stop} className="btn-primary shrink-0">
          <Square className="h-3 w-3 fill-current" aria-hidden />
          Stop
        </button>
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
      </div>
    );

  return (
    <div className="animate-fadein">
      {phase === "unsupported" ? (
        <p className="text-base text-muted">This browser can't record. Upload a recording or paste a transcript instead.</p>
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
