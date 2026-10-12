import clsx from "clsx";
import { FileText, X } from "lucide-react";
import { formatBytes } from "../../lib/api";

/** A chosen file: icon, name, size, and a quiet remove button. */
export function FileRow({ name, size, onRemove, className }: { name: string; size?: number; onRemove?: () => void; className?: string }) {
  return (
    <div className={clsx("flex animate-fade-in items-center gap-3 rounded-lg bg-ink/[0.04] py-2 pl-3 pr-1.5 text-sm", className)}>
      <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
      {size !== undefined && <span className="tnum shrink-0 text-xs text-faint">{formatBytes(size)}</span>}
      {onRemove && (
        <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label={`Remove ${name}`} onClick={onRemove}>
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Several chosen files, stacked. */
export function FileList({ files, onRemove, className }: { files: { name: string; size?: number }[]; onRemove?: (i: number) => void; className?: string }) {
  if (!files.length) return null;
  return (
    <ul className={clsx("space-y-1.5", className)}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`}>
          <FileRow name={f.name} size={f.size} onRemove={onRemove && (() => onRemove(i))} />
        </li>
      ))}
    </ul>
  );
}
