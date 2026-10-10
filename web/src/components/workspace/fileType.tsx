import clsx from "clsx";
import { FileText, FileType2, NotebookText } from "lucide-react";

export type FileKind = "pdf" | "word" | "text";

export function fileKind(filename: string, mime = ""): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime.includes("pdf")) return "pdf";
  if (ext === "docx" || ext === "doc" || mime.includes("word")) return "word";
  return "text";
}

/** Plain-text files the browser can show directly in the preview. */
export const isPlainText = (filename: string, mime = "") => /\.(md|markdown|txt)$/i.test(filename) || mime.startsWith("text/");

/** A quiet monochrome document icon in a hairline square. */
export function DocIcon({ filename, mime, className }: { filename: string; mime?: string; className?: string }) {
  const kind = fileKind(filename, mime);
  const Icon = kind === "pdf" ? FileType2 : kind === "word" ? FileText : NotebookText;
  return (
    <span aria-hidden className={clsx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-line text-muted", className)}>
      <Icon className="h-4 w-4" strokeWidth={1.6} />
    </span>
  );
}
