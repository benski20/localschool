import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { FileDown, MoreHorizontal } from "lucide-react";
import { downloadDocx } from "../../lib/api";
import { BackLink } from "./ToolPage";
import { CopyButton, SaveHint, type SaveState } from "./OutputEditor";

/**
 * The top of every finished result, laid out like a document: a quiet back link, a serif
 * title, Copy plus a "⋯" menu on the right, then a row of chips (date, student, type…).
 */
export function DocHeader({
  title,
  back,
  saved,
  copy,
  word,
  menu,
  chips,
  className,
}: {
  title: ReactNode;
  back?: { to: string; label: string };
  saved?: SaveState;
  /** What Copy copies (plain text). */
  copy?: () => string;
  /** Word download: document title and text. */
  word?: { title: string; text: () => string };
  /** Extra items for the ⋯ menu. */
  menu?: MenuItem[];
  chips?: ReactNode;
  className?: string;
}) {
  const items: MenuItem[] = [
    ...(word ? [{ label: "Download for Word", icon: <FileDown className="h-4 w-4" aria-hidden />, onSelect: () => downloadDocx(word.title, word.text()) }] : []),
    ...(menu ?? []),
  ];
  return (
    <header className={clsx("animate-fade-in", className)}>
      {back && <BackLink to={back.to} label={back.label} />}
      <div className={clsx("flex items-start justify-between gap-4", back && "mt-5")}>
        <h1 className="min-w-0 font-serif text-[32px] leading-[40px] tracking-[-0.01em] text-ink sm:text-[36px] sm:leading-[44px]">{title}</h1>
        <div className="mt-1.5 flex shrink-0 items-center gap-2">
          {saved && <SaveHint state={saved} />}
          {copy && <CopyButton text={copy} />}
          {items.length > 0 && <MoreMenu items={items} />}
        </div>
      </div>
      {chips && <div className="mt-5 flex flex-wrap items-center gap-2">{chips}</div>}
    </header>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/** A small "⋯" button with a popover of actions (keeps result pages free of button rows). */
export function MoreMenu({ items, label = "More", className }: { items: MenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={root} className={clsx("relative", className)}>
      <button
        type="button"
        className="btn-ghost btn-icon btn-sm text-muted"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="surface-pop absolute right-0 top-full z-50 mt-1.5 min-w-[13rem] animate-scale-in p-1">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-subtle",
                it.danger ? "text-danger" : "text-ink",
              )}
            >
              {it.icon && <span className="text-faint">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
