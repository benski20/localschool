import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Upload } from "lucide-react";
import "./common.css";

/**
 * Drop files anywhere on the page. Mount it once on a page; it listens on the window,
 * appears only while files (not text or links) are dragged over, and hands the
 * dropped files to `onFiles`.
 *
 *   <DropZoneOverlay onFiles={(files) => upload.add(files)} label="Drop to attach" />
 */
export function DropZoneOverlay({
  onFiles,
  label = "Drop files to upload",
  hint,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  /** Large line in the overlay. */
  label?: string;
  /** Optional small line under the label. */
  hint?: string;
  /** Ignore drags entirely (e.g. while a dialog that has its own drop target is open). */
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  cb.current = onFiles;

  useEffect(() => {
    if (disabled) {
      depth.current = 0;
      setOver(false);
      return;
    }
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) cb.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overFn);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [disabled]);

  return createPortal(
    <div
      aria-hidden={!over}
      className={clsx(
        "ls-drop pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-bg/80 p-4 backdrop-blur-[2px] md:p-6",
        over ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={clsx(
          "ls-drop-frame flex h-full w-full flex-col items-center justify-center gap-3 rounded-[3px] border border-dashed border-ink/25 text-center",
          over ? "scale-100" : "scale-[0.985]",
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink/[0.04] text-ink">
          <Upload className="h-5 w-5" strokeWidth={1.6} />
        </span>
        <span className="text-[17px] text-ink">{label}</span>
        {hint && <span className="text-[13px] text-faint">{hint}</span>}
      </div>
      {over && (
        <span role="status" className="sr-only">
          {label}
        </span>
      )}
    </div>,
    document.body,
  );
}
