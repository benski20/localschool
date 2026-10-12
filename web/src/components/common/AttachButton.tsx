import { useRef } from "react";
import clsx from "clsx";
import { Paperclip } from "lucide-react";
import { UPLOAD_ACCEPT } from "./useUpload";

/** Paperclip icon button that opens the file chooser (multiple files). */
export function AttachButton({
  onFiles,
  disabled,
  label = "Attach files",
  className,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={clsx(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
      >
        <Paperclip className="h-[17px] w-[17px]" strokeWidth={1.6} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
