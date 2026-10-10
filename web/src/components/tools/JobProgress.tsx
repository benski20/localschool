import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Progress } from "../ui";
import { isWorking, statusWord, tools, type Draft, type ToolKey } from "../../lib/tools";
import { ErrorLine } from "./ToolPage";

/** Calm progress: one line of text and a hairline bar. `progress` is 0–1, or null when unknown. */
export function JobProgress({ label, progress, note, className }: { label: string; progress: number | null; note?: string; className?: string }) {
  const pct = progress === null || progress <= 0 ? null : Math.min(100, Math.round(progress * 100));
  return (
    <div className={clsx("animate-fadein py-6", className)} aria-live="polite">
      <div className="mb-3 flex items-baseline justify-between gap-4 text-base">
        <span className="text-ink">{label}</span>
        {pct !== null && <span className="tnum text-sm text-faint">{pct}%</span>}
      </div>
      <Progress value={pct} />
      {note && <p className="mt-4 text-sm text-faint">{note}</p>}
    </div>
  );
}

/** JobProgress for a draft that is queued or running. */
export function DraftProgress({ draft, note }: { draft: Draft; note?: string }) {
  const ahead = draft.status === "queued" && draft.queue_position && draft.queue_position > 1 ? draft.queue_position - 1 : 0;
  return (
    <JobProgress
      label={statusWord(draft)}
      progress={draft.status === "running" ? draft.progress : null}
      note={ahead ? `${ahead} ahead of you. ${note ?? ""}`.trim() : note}
    />
  );
}

const POLL_MS = 1200;

/**
 * Load a draft and keep polling it while its job is queued or running.
 * `initial` (e.g. from navigation state) shows immediately without a loading flash.
 */
export function useDraft<T extends ToolKey>(id: number | null, initial?: Draft<T> | null) {
  const [draft, setDraft] = useState<Draft<T> | null>(initial && initial.id === id ? initial : null);
  const [error, setError] = useState("");
  const [nudge, setNudge] = useState(0);
  const timer = useRef<number>();

  useEffect(() => {
    setError("");
    if (id === null) {
      setDraft(null);
      return;
    }
    setDraft((d) => (d?.id === id ? d : initial && initial.id === id ? initial : null));
    let alive = true;
    const tick = () => {
      tools
        .get<T>(id)
        .then((d) => {
          if (!alive) return;
          setDraft(d);
          if (isWorking(d.status)) timer.current = window.setTimeout(tick, POLL_MS);
        })
        .catch((e: Error) => alive && setError(e.message));
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nudge]);

  /** Replace the draft (e.g. after retry) and resume polling. */
  const restart = (d: Draft<T>) => {
    setDraft(d);
    setNudge((n) => n + 1);
  };

  return { draft, setDraft, restart, error };
}

/** Run a finished or failed draft's job again. */
export function RetryButton<T extends Draft>({ id, onRetry }: { id: number; onRetry: (d: T) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailure("");
          try {
            onRetry((await tools.retry(id)) as T);
          } catch (e) {
            setFailure((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Try again
      </button>
      {failure && <ErrorLine>{failure}</ErrorLine>}
    </div>
  );
}

