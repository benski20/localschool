import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight, Square } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** "hero": the large first-question form. "dock": the compact box anchored under a thread. */
  variant?: "hero" | "dock";
  /** Hero only: rendered between the field and the submit row (suggestions, status). */
  children?: ReactNode;
}

/** Flat, auto-growing question box. ↵ or ⌘↵ asks, ⇧↵ adds a line, Esc stops a running answer. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { value, onChange, onSubmit, onStop, busy, disabled, placeholder, variant = "dock", children },
  handle,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const hero = variant === "hero";
  const maxH = hero ? 320 : 220;
  useImperativeHandle(handle, () => ({ focus: () => ta.current?.focus() }), []);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }, [value, maxH]);

  // "/" focuses the composer from anywhere that isn't already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      ta.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canSend = !busy && !disabled && value.trim().length > 0;

  const field = (
    <textarea
      id="ask"
      ref={ta}
      rows={1}
      value={value}
      autoFocus
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && busy) {
          e.preventDefault();
          onStop();
          return;
        }
        if (e.key === "Enter" && !e.nativeEvent.isComposing && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (canSend) onSubmit();
        }
      }}
      placeholder={placeholder ?? "Ask about your classes or school policies…"}
      className={clsx(
        "block w-full resize-none bg-transparent text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        hero ? "min-h-[136px] px-4 py-3.5 text-[16px] leading-[26px] md:px-5 md:py-4" : "min-h-[26px] px-4 pb-1 pt-3 text-[15.5px] leading-[24px]",
      )}
    />
  );

  const hints = (
    <div className="hidden min-w-0 items-center gap-4 text-xs text-faint sm:flex" aria-hidden>
      {busy ? (
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">Esc</kbd> stop
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↵</kbd> ask
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">⇧↵</kbd> new line
          </span>
          {hero && (
            <span className="hidden items-center gap-1.5 md:flex">
              <kbd className="kbd">/</kbd> focus
            </span>
          )}
        </>
      )}
    </div>
  );

  const button = busy ? (
    <button
      type="button"
      onClick={onStop}
      className={clsx(
        "chat-pop inline-flex shrink-0 items-center gap-2 rounded-[2px] border border-line-strong bg-panel font-medium text-ink transition-colors hover:bg-subtle",
        hero ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
      )}
      aria-label="Stop generating"
    >
      <Square className="h-3 w-3 fill-current" />
      Stop
    </button>
  ) : (
    <button
      type="submit"
      disabled={!canSend}
      title={`Ask (↵ or ${isMac ? "⌘" : "Ctrl"}↵)`}
      className={clsx(
        "inline-flex shrink-0 items-center gap-2 rounded-[2px] font-medium transition-colors duration-150",
        hero ? "h-10 px-5 text-[14px]" : "h-8 px-3.5 text-[13px]",
        canSend ? "bg-ink text-bg hover:bg-ink/85" : "cursor-not-allowed bg-ink/[0.08] text-faint",
      )}
    >
      Ask
      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSend) onSubmit();
  };

  if (hero) {
    return (
      <form onSubmit={submit}>
        <label htmlFor="ask" className="mb-2 block text-[15px] font-medium text-ink">
          Question
        </label>
        <div className="rounded-[2px] border border-line bg-bg transition-colors hover:border-line-strong focus-within:border-ink/30 focus-within:bg-panel">
          {field}
        </div>
        {children}
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-6">
          {hints}
          <div className="ml-auto">{button}</div>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[2px] border border-line bg-panel transition-colors focus-within:border-ink/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          ta.current?.focus();
        }
      }}
    >
      <label htmlFor="ask" className="sr-only">
        Ask a question
      </label>
      {field}
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-1.5 md:pl-4">
        {hints}
        <div className="ml-auto">{button}</div>
      </div>
    </form>
  );
});
