import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Copy, FileDown } from "lucide-react";
import { downloadDocx } from "../../lib/api";
import { tools, type Draft, type ToolIO, type ToolKey } from "../../lib/tools";

/**
 * Text that reads like the page until you touch it: no box at rest, a hairline on hover,
 * a quiet field on focus. Grows with its content.
 */
export function EditableText({
  value,
  onChange,
  label,
  className,
  placeholder,
  single,
  tone = "ink",
}: {
  value: string;
  onChange: (v: string) => void;
  /** Accessible name (not shown). */
  label: string;
  className?: string;
  placeholder?: string;
  /** One line (Enter does nothing). */
  single?: boolean;
  /** "faint" for text the teacher didn't write (e.g. added from a recording). */
  tone?: "ink" | "faint";
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(single ? e.target.value.replace(/\n/g, " ") : e.target.value)}
      onKeyDown={single ? (e) => e.key === "Enter" && e.preventDefault() : undefined}
      className={clsx(
        "-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-sm border border-transparent bg-transparent px-2 py-1 text-base leading-[26px] outline-none",
        tone === "faint" ? "text-faint" : "text-ink",
        "transition-[border-color,background-color] duration-fast hover:border-line focus:border-ink/40 focus:bg-panel",
        className,
      )}
    />
  );
}

export function CopyButton({
  text,
  label = "Copy",
  size = "sm",
  className,
}: {
  text: string | (() => string);
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const t = useRef<number>();
  useEffect(() => () => window.clearTimeout(t.current), []);
  const copy = async () => {
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older/insecure contexts: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <button type="button" onClick={copy} className={clsx("btn-secondary", size === "sm" && "btn-sm", className)} aria-live="polite">
      {done ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Download as a Word document: same text as Copy, formatted for Word. */
export function WordButton({
  title,
  text,
  size = "sm",
  className,
}: {
  title: string | (() => string);
  text: string | (() => string);
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => downloadDocx(typeof title === "function" ? title() : title, typeof text === "function" ? text() : text)}
      className={clsx("btn-secondary", size === "sm" && "btn-sm", className)}
      title="Download as a Word document"
    >
      <FileDown className="h-3.5 w-3.5" aria-hidden />
      Word
    </button>
  );
}

/** A result block: small label, quiet save state, actions on the right; content fades in. */
export function OutputEditor({
  label,
  actions,
  saved,
  children,
  className,
}: {
  label?: ReactNode;
  actions?: ReactNode;
  saved?: SaveState;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("animate-slide-up", className)}>
      {(label || actions || saved) && (
        <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
          <h2 className="label">{label}</h2>
          <div className="flex items-center gap-3">
            {saved && <SaveHint state={saved} />}
            {actions}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveHint({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className={clsx("animate-fade-in text-xs", state === "error" ? "text-danger" : "text-faint")} aria-live="polite">
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Couldn't save"}
    </span>
  );
}

/**
 * Local, editable copy of a draft's output that saves itself (debounced) to PUT /api/drafts/{id}.
 * No Save button: edits are kept as the teacher types.
 */
export function useDraftOutput<T extends ToolKey>(draft: Draft<T> | null) {
  const [output, setLocal] = useState<ToolIO[T]["output"] | null>(draft?.output ?? null);
  const [saved, setSaved] = useState<SaveState>("idle");
  const dirty = useRef(false);
  const id = draft?.id ?? null;

  // Take the server's output when a new draft arrives or its job finishes.
  useEffect(() => {
    dirty.current = false;
    setLocal(draft?.output ?? null);
    setSaved("idle");
  }, [id, draft?.status, draft?.output]);

  useEffect(() => {
    if (!dirty.current || id === null || output === null) return;
    setSaved("saving");
    const t = window.setTimeout(() => {
      tools
        .save<T>(id, output)
        .then(() => setSaved("saved"))
        .catch(() => setSaved("error"));
    }, 700);
    return () => window.clearTimeout(t);
  }, [output, id]);

  const setOutput = useCallback((next: ToolIO[T]["output"]) => {
    dirty.current = true;
    setLocal(next);
  }, []);

  return { output, setOutput, saved };
}
