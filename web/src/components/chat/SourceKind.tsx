import clsx from "clsx";
import { FileText, Paperclip, UserRound } from "lucide-react";
import type { Source } from "../../lib/types";

const KIND = {
  document: { label: "Document", icon: FileText, tone: "text-faint", box: "border-line text-muted" },
  attachment: { label: "Your file", icon: Paperclip, tone: "text-accent", box: "border-accent/25 text-accent" },
  student: { label: "Student", icon: UserRound, tone: "text-warning", box: "border-warning/30 text-warning" },
} as const;

const kindOf = (k: string) => KIND[(k in KIND ? k : "document") as keyof typeof KIND];

/**
 * The one place that decides how each source kind looks, so chips, previews and the
 * panel agree. Documents read neutral, the teacher's own files blue, student records amber.
 */
export function SourceKindLabel({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const k = kindOf(kind);
  const Icon = k.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em]", k.tone, className)}>
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {k.label}
    </span>
  );
}

export function SourceKindIcon({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const k = kindOf(kind);
  const Icon = k.icon;
  return (
    <span className={clsx("flex shrink-0 items-center justify-center rounded-[2px] border", k.box, className ?? "h-7 w-7")} aria-hidden>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
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
