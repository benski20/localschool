import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Progress } from "../ui";
import { isWorking, tools, type Draft, type ToolKey } from "../../lib/tools";

/** Calm progress for a background job: one line of text, a hairline bar. */
export function JobProgress({ label, progress, note, className }: { label: string; progress: number | null; note?: string; className?: string }) {
  const pct = progress === null ? null : Math.round(progress);
  return (
    <div className={clsx("animate-fadein py-6", className)} aria-live="polite">
      <div className="mb-3 flex items-baseline justify-between gap-4 text-base">
        <span className="text-ink">{label}</span>
        {pct !== null && pct > 0 && <span className="tnum text-sm text-faint">{pct}%</span>}
      </div>
      <Progress value={pct && pct > 0 ? pct : null} />
      {note && <p className="mt-4 text-sm text-faint">{note}</p>}
    </div>
  );
}

/** Teacher-facing word for a draft's state. */
export function statusWord(d: Pick<Draft, "status">): string {
  if (d.status === "queued") return "Waiting…";
  if (d.status === "running") return "Working…";
  if (d.status === "error") return "Didn't work";
  return "Ready";
}

const POLL_MS = 1200;

/**
 * Load a draft and keep polling it while its job is queued or running.
 * `initial` (e.g. from navigation state) shows immediately without a loading flash.
 */
export function useDraft<T extends ToolKey>(id: number | null, initial?: Draft<T> | null) {
  const [draft, setDraft] = useState<Draft<T> | null>(initial && initial.id === id ? initial : null);
  const [error, setError] = useState("");
  const timer = useRef<number>();

  useEffect(() => {
    setError("");
    if (id === null) {
      setDraft(null);
      return;
    }
    if (!(initial && initial.id === id)) setDraft(null);
    let alive = true;
    const tick = (first: boolean) => {
      tools
        .get<T>(id)
        .then((d) => {
          if (!alive) return;
          // Keep the teacher's local edits: only replace the output while the job is still producing it.
          setDraft((prev) => (prev && prev.status === "ready" && d.status === "ready" && !first ? prev : d));
          if (isWorking(d.status)) timer.current = window.setTimeout(() => tick(false), POLL_MS);
        })
        .catch((e: Error) => {
          if (!alive) return;
          setError(e.message);
        });
    };
    tick(true);
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { draft, setDraft, error };
}
