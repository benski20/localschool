import { useEffect, useRef } from "react";
import clsx from "clsx";
import type { Segment } from "../../lib/tools";

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

/** The timestamp for a line, or its line number when the transcript had no times. */
export const stamp = (s: Segment, i: number) => (s.start === null ? `#${i + 1}` : clock(s.start));

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A request to bring a line into view; `n` changes on every click so the same line can be re-focused. */
export interface TranscriptFocus {
  index: number;
  n: number;
}

/** The transcript, one line per segment. Clicking a timestamp highlights that line. */
export function TranscriptView({
  segments,
  focus,
  onFocus,
  className,
}: {
  segments: Segment[];
  focus: TranscriptFocus | null;
  onFocus: (index: number) => void;
  className?: string;
}) {
  const lines = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (!focus) return;
    lines.current[focus.index]?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  }, [focus]);

  return (
    <ol className={clsx("space-y-1", className)}>
      {segments.map((s, i) => (
        <li
          key={i}
          ref={(el) => (lines.current[i] = el)}
          className={clsx(
            "flex gap-3 rounded-sm px-2 py-1.5 text-sm leading-[22px] transition-colors duration-slow",
            focus?.index === i ? "bg-accent-soft text-ink" : "text-muted",
          )}
        >
          <button
            type="button"
            onClick={() => onFocus(i)}
            className="tnum w-11 shrink-0 self-start text-left font-mono text-xs leading-[22px] text-faint hover:text-accent"
            aria-label={`Line ${stamp(s, i)}`}
          >
            {stamp(s, i)}
          </button>
          <span className="min-w-0">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Small timestamp chips beside a note: the receipts. Each one jumps to its transcript line. */
export function RefChips({
  refs,
  segments,
  onJump,
  className = "mt-1",
}: {
  refs?: number[];
  segments: Segment[];
  onJump: (i: number) => void;
  className?: string;
}) {
  const valid = (refs ?? []).filter((r) => r >= 0 && r < segments.length).slice(0, 4);
  if (!valid.length) return null;
  return (
    <span className={clsx("flex flex-wrap gap-1.5", className)}>
      {valid.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onJump(r)}
          className="tnum inline-flex h-5 items-center rounded-sm border border-line px-1.5 font-mono text-2xs text-accent transition-colors hover:border-accent/50 hover:bg-accent-soft"
          aria-label={`Show transcript line ${stamp(segments[r]!, r)}`}
        >
          {stamp(segments[r]!, r)}
        </button>
      ))}
    </span>
  );
}
