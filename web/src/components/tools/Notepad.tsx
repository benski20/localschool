import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { tools } from "../../lib/tools";
import type { SaveState } from "./OutputEditor";

const SAVE_MS = 2500;

/**
 * The teacher's own meeting notes, saved to PUT /api/meetings/{id}/notepad a moment after typing
 * stops (and on flush). A failed save is quiet: the text stays on the page and the next save retries.
 */
export function useNotepad(id: number | null, initial = "") {
  const [text, setLocal] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const latest = useRef(initial);
  const savedText = useRef(initial);
  const timer = useRef<number>();
  const idRef = useRef(id);
  idRef.current = id;

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const target = idRef.current;
    const value = latest.current;
    if (target === null || value === savedText.current) return;
    setState("saving");
    try {
      await tools.saveNotepad(target, value);
      savedText.current = value;
      if (latest.current === value) setState("saved");
    } catch {
      setState("error");
    }
  }, []);

  const setText = useCallback(
    (v: string) => {
      latest.current = v;
      setLocal(v);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(save, SAVE_MS);
    },
    [save],
  );

  // A different meeting (or the server's copy arriving) resets the notepad.
  useEffect(() => {
    latest.current = initial;
    savedText.current = initial;
    setLocal(initial);
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, initial]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { text, setText, state, flush: save };
}

export function NotepadHint({ state }: { state: SaveState }) {
  if (state === "idle" || state === "saving") return null;
  return (
    <span className="animate-fade-in text-xs text-faint" aria-live="polite">
      {state === "saved" ? "Saved" : "Couldn't save notes"}
    </span>
  );
}

/** A large, borderless writing surface that grows with its text. */
export function NotepadField({
  value,
  onChange,
  autoFocus,
  className,
  placeholder = "Type notes as you go — or don't. Your notes become the backbone.",
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      spellCheck
      aria-label="Your notes"
      placeholder={placeholder}
      className={clsx(
        "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-md leading-[28px] text-ink outline-none placeholder:text-faint focus:ring-0",
        className,
      )}
    />
  );
}
