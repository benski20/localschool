import clsx from "clsx";
import { Check, FileText, RotateCcw, X } from "lucide-react";
import type { UploadItem } from "./useUpload";
import "./common.css";

/**
 * One attached file: name, a thin progress bar while uploading / getting ready,
 * then a check. Failed files show the reason and a retry.
 */
export function AttachmentChip({
  item,
  onRemove,
  onRetry,
  className,
}: {
  item: UploadItem;
  onRemove?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const { state } = item;
  const working = state === "uploading" || state === "processing";
  const failed = state === "error";
  const status = working ? (state === "uploading" ? "Uploading" : "Getting ready") : failed ? item.error || "Couldn't read this file" : "Ready";

  return (
    <span
      className={clsx(
        "ls-chip relative inline-flex h-8 max-w-full items-center gap-2 overflow-hidden rounded-[2px] border bg-panel pl-2.5 pr-1 text-[13px]",
        failed ? "border-danger/35" : "border-line",
        className,
      )}
      title={failed ? item.error : item.name}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
        {state === "ready" ? (
          <Check key="ok" className="ls-check h-3.5 w-3.5 text-success" strokeWidth={2.25} />
        ) : (
          <FileText className={clsx("h-3.5 w-3.5", failed ? "text-danger" : "text-faint")} strokeWidth={1.75} />
        )}
      </span>
      <span className="min-w-0 max-w-[220px] truncate text-ink">{item.name}</span>
      {failed ? (
        <span className="hidden min-w-0 max-w-[180px] truncate text-[12px] text-danger sm:inline">{status}</span>
      ) : (
        <span className={clsx("shrink-0 text-[12px]", state === "ready" ? "text-faint" : "text-faint")}>{state === "ready" ? "Ready" : null}</span>
      )}
      <span className="sr-only" role="status">
        {item.name}: {status}
      </span>
      {failed && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry ${item.name}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] text-faint transition-colors hover:bg-subtle hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] text-faint transition-colors hover:bg-subtle hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : (
        <span className="w-1.5" aria-hidden />
      )}
      {/* Thin progress along the bottom edge; fades once ready. */}
      <span
        aria-hidden
        className={clsx("ls-chip-bar absolute bottom-0 left-0 h-[2px] bg-accent", working ? "opacity-100" : "opacity-0")}
        style={{ width: `${Math.round((state === "ready" ? 1 : item.progress) * 100)}%` }}
      />
    </span>
  );
}
