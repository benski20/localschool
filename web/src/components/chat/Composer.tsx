import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowUp, Square } from "lucide-react";

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  /** Extra gate on asking (e.g. a file is still uploading). */
  blocked?: boolean;
  placeholder?: string;
  /** "hero": the large first-question box. "dock": the box under a conversation. */
  variant?: "hero" | "dock";
  /** Inside the box, above the field (attachment chips). */
  top?: ReactNode;
  /** Left side of the bottom bar (attach, model picker). */
  tools?: ReactNode;
  autoFocus?: boolean;
}

/** One calm box: the question, then a bottom bar with tools on the left and Ask on the right. ↵ asks, ⇧↵ adds a line. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { value, onChange, onSubmit, onStop, busy, blocked, placeholder, variant = "dock", top, tools, autoFocus = true },
  handle,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLTextAreaElement>(null);
  const hero = variant === "hero";
  const minH = hero ? 84 : 28;
  const maxH = hero ? 320 : 220;
  useImperativeHandle(
    handle,
    () => ({
      focus: () => {
        const el = ta.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      },
    }),
    [],
  );

  // Grow smoothly: measure an invisible twin so the real field can transition its height.
  useLayoutEffect(() => {
    const el = ta.current;
    const m = mirror.current;
    if (!el || !m) return;
    m.value = value || " ";
    const h = Math.max(minH, Math.min(m.scrollHeight, maxH));
    el.style.height = `${h}px`;
    el.style.overflowY = m.scrollHeight > maxH ? "auto" : "hidden";
  }, [value, minH, maxH]);

  const canSend = !busy && !blocked && value.trim().length > 0;
  const fieldCls = clsx(
    "block w-full resize-none bg-transparent text-ink placeholder:text-faint focus:outline-none",
    hero ? "px-5 pt-4 text-[17px] leading-[27px]" : "px-4 pt-3 text-[15.5px] leading-[24px]",
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSend) onSubmit();
  };

  return (
    <form
      onSubmit={submit}
      className={clsx(
        "relative rounded-[3px] border bg-panel transition-colors duration-150",
        "border-line hover:border-line-strong focus-within:border-ink/25 focus-within:hover:border-ink/25",
      )}
      onMouseDown={(e) => {
        // Clicking the box's empty space focuses the field.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          ta.current?.focus();
        }
      }}
    >
      <label htmlFor="ask" className="sr-only">
        Your question
      </label>
      {top}
      <textarea
        id="ask"
        ref={ta}
        rows={1}
        value={value}
        autoFocus={autoFocus}
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
        placeholder={placeholder ?? "Ask about your students or school policies"}
        className={clsx(fieldCls, "chat-grow")}
        style={{ height: minH }}
      />
      <textarea ref={mirror} rows={1} tabIndex={-1} aria-hidden readOnly className={clsx(fieldCls, "pointer-events-none invisible absolute left-0 top-0 h-0 pb-0")} />
      <div className={clsx("flex items-center gap-1", hero ? "px-3 pb-3 pt-2" : "px-2.5 pb-2.5 pt-1.5")}>
        {tools}
        <div className="ml-auto">
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="chat-pop inline-flex h-9 shrink-0 items-center gap-2 rounded-[2px] border border-line-strong bg-panel px-3.5 text-[13.5px] text-ink transition-colors hover:bg-subtle"
              aria-label="Stop the answer"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={clsx(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[2px] pl-3.5 pr-3 text-[14px] font-medium transition-colors duration-150",
                canSend ? "bg-ink text-bg hover:bg-ink/85" : "cursor-not-allowed bg-ink/[0.07] text-faint",
              )}
            >
              Ask
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
});
