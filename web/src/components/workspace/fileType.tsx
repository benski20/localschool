import clsx from "clsx";
import { FileCode2, FileText, FileType2, NotebookText } from "lucide-react";

export type FileKind = "pdf" | "word" | "markdown" | "text";

export function fileKind(filename: string, mime = ""): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime.includes("pdf")) return "pdf";
  if (ext === "docx" || ext === "doc" || mime.includes("word")) return "word";
  if (ext === "md" || ext === "markdown" || mime.includes("markdown")) return "markdown";
  return "text";
}

export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", word: "Word", markdown: "Markdown", text: "Text" };
const KIND_TAG: Record<FileKind, string> = { pdf: "PDF", word: "DOC", markdown: "MD", text: "TXT" };

/** A document tile: a folded-corner page with a short type tag. Monochrome by design. */
export function FileTile({ kind, size = "md", className }: { kind: FileKind; size?: "md" | "lg"; className?: string }) {
  const Icon = kind === "pdf" ? FileType2 : kind === "word" ? FileText : kind === "markdown" ? FileCode2 : NotebookText;
  const lg = size === "lg";
  return (
    <span
      aria-hidden
      className={clsx(
        "relative inline-flex shrink-0 flex-col items-center justify-center rounded-[2px] border border-line bg-panel text-muted",
        lg ? "h-12 w-10" : "h-9 w-[30px]",
        className,
      )}
    >
            <Icon className={lg ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={1.75} />
      <span className={clsx("mt-0.5 font-mono font-medium leading-none text-faint", lg ? "text-[9px]" : "text-[8px]")}>{KIND_TAG[kind]}</span>
    </span>
  );
}
