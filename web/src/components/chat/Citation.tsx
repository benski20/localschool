import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { Source } from "../../lib/types";
import { SourceKindLabel } from "./SourceKind";

/** Inline numbered citation. Hover/focus shows a preview; click opens the source panel. */
export function CitationChip({ source, active, onOpen }: { source: Source; active: boolean; onOpen: (n: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 140);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          hide();
          onOpen(source.n);
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={hide}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={hide}
        aria-label={`Source ${source.n}: ${source.title}`}
        className={clsx(
          "mx-[1.5px] inline-flex h-[18px] min-w-[18px] -translate-y-[1.5px] items-center justify-center rounded-lg border px-[4px] align-middle font-mono text-[10.5px] font-medium leading-none tabular-nums transition-colors duration-150",
          active
            ? "border-accent bg-accent text-accent-fg"
            : "border-accent/25 bg-accent-soft text-accent hover:border-accent hover:bg-accent hover:text-accent-fg",
        )}
      >
        {source.n}
      </button>
      {open && ref.current && <Preview anchor={ref.current} source={source} />}
    </>
  );
}

function Preview({ anchor, source }: { anchor: HTMLElement; source: Source }) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const w = card.current?.offsetWidth ?? 340;
    const h = card.current?.offsetHeight ?? 160;
    const left = Math.min(Math.max(12, a.left + a.width / 2 - w / 2), window.innerWidth - w - 12);
    const below = a.top - h - 10 < 8;
    setPos({ left, top: below ? a.bottom + 8 : a.top - h - 8 });
  }, [anchor]);

  const snippet = source.kind === "student" ? source.text.split("\n").slice(0, 3).join(" · ") : source.text;

  return createPortal(
    <div
      ref={card}
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={clsx(
        "pointer-events-none fixed z-50 w-[340px] max-w-[calc(100vw-24px)] rounded-lg border border-ink/[0.07] bg-panel",
        pos && "chat-pop",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <SourceKindLabel kind={source.kind} />
        <span className="font-mono text-[11px] tabular-nums text-faint">{source.n}</span>
      </div>
      <div className="px-3.5 py-3">
        <div className="line-clamp-1 text-[13.5px] font-medium text-ink">{source.title}</div>
        {source.subtitle && <div className="line-clamp-1 text-xs text-faint">{source.subtitle}</div>}
        <p className="mt-2 line-clamp-4 text-[12.5px] leading-[19px] text-muted">{snippet}</p>
      </div>
    </div>,
    document.body,
  );
}
