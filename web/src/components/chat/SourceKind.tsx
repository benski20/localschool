import clsx from "clsx";
import { FileText, UserRound } from "lucide-react";
import type { Source } from "../../lib/types";

/**
 * The one place that decides how "document" vs "student record" look, so chips,
 * previews and the panel always agree. Uppercase colored text, no filled pills:
 * documents read neutral, student records amber (confidential roster data).
 */
export function SourceKindLabel({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const student = kind === "student";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em]",
        student ? "text-warning" : "text-faint",
        className,
      )}
    >
      {student ? <UserRound className="h-3 w-3" strokeWidth={1.75} /> : <FileText className="h-3 w-3" strokeWidth={1.75} />}
      {student ? "Student record" : "Document"}
    </span>
  );
}

export function SourceKindIcon({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const student = kind === "student";
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-[2px] border",
        student ? "border-warning/30 text-warning" : "border-line text-muted",
        className ?? "h-7 w-7",
      )}
      aria-hidden
    >
      {student ? <UserRound className="h-3.5 w-3.5" strokeWidth={1.75} /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </span>
  );
}

/** Flat, square citation number. Shared by inline chips, source rows and the panel. */
export function CiteNumber({ n, active, className }: { n: number; active?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[2px] border px-[4px] font-mono text-[10.5px] font-medium leading-none tabular-nums",
        active ? "border-accent bg-accent text-accent-fg" : "border-accent/25 bg-accent-soft text-accent",
        className,
      )}
    >
      {n}
    </span>
  );
}
