import clsx from "clsx";
import { FileText, Paperclip, UserRound } from "lucide-react";
import type { Source } from "../../lib/types";

const KIND = {
  document: { label: "Document", icon: FileText, tone: "text-faint", box: "bg-ink/[0.045] text-muted" },
  attachment: { label: "Your file", icon: Paperclip, tone: "text-accent", box: "bg-accent-soft text-accent" },
  student: { label: "Student", icon: UserRound, tone: "text-warning", box: "bg-warning/[0.1] text-warning" },
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
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", k.tone, className)}>
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {k.label}
    </span>
  );
}

export function SourceKindIcon({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const k = kindOf(kind);
  const Icon = k.icon;
  return (
    <span className={clsx("flex shrink-0 items-center justify-center rounded-md", k.box, className ?? "h-7 w-7")} aria-hidden>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  );
}

/** Filled accent pill with the citation number. Shared by inline chips, source rows and the panel. */
export function CiteNumber({ n, active, className }: { n: number; active?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] font-mono text-[10.5px] font-medium leading-none tabular-nums",
        active ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent",
        className,
      )}
    >
      {n}
    </span>
  );
}
