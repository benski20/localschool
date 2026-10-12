/**
 * Small shared pieces for Documents, Students and Settings: a centered page, a serif title with an
 * optional subtitle, a floating side sheet, a dialog, a confirm, a search field, pill tabs, chips,
 * a thin bar and a disclosure.
 * The borderless canvas (same as the Tools pages): things on the page sit on soft tints with no
 * outlines or divider lines; only floating layers (sheets, dialogs) get a whisper edge and a soft
 * shadow. Soft corners, sentence-case labels, lots of air.
 */
import "./workspace.css";
import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { ChevronRight, Search, X } from "lucide-react";
import { Spinner } from "../ui";

/* ------------------------------------------------------------------ Page */

/** Centered column with generous gutters. */
export function Page({ children, width = 760 }: { children: ReactNode; width?: number }) {
  return (
    <div className="mx-auto w-full px-4 pb-24 pt-8 sm:px-8 sm:pt-12" style={{ maxWidth: width + 64 }}>
      {children}
    </div>
  );
}

/**
 * Serif title (the same as the Tools pages) with an optional muted subtitle on the left, at most a
 * couple of controls on the right. `stretch` lets filter controls take a full row of their own on phones.
 */
export function PageTitle({ title, subtitle, actions, stretch }: { title: string; subtitle?: ReactNode; actions?: ReactNode; stretch?: boolean }) {
  return (
    <header className="ws-rise flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
      <div className="min-w-0">
        <h1 className="font-serif text-[32px] leading-[40px] tracking-[-0.01em] text-ink sm:text-[36px] sm:leading-[44px]">{title}</h1>
        {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
      </div>
      {actions && <div className={clsx("flex min-w-0 items-center gap-2 sm:pt-1", stretch && "w-full sm:w-auto")}>{actions}</div>}
    </header>
  );
}

/** A quiet in-page section: small heading, then content. */
export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("ws-rise", className)} aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-normal text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Search */

export function SearchField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={clsx("group relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint transition-colors group-focus-within:text-ink" strokeWidth={1.75} aria-hidden />
      <input
        type="search"
        className="input h-9 pl-9 pr-8 text-sm [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) onChange("");
        }}
      />
      {value && (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-faint transition-colors hover:text-ink"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */

/** Two or three choices as a pill toggle. */
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="segmented">
      {items.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Chips */

type Tone = "neutral" | "strong" | "warning" | "danger";

export function Chip({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex h-[22px] max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs",
        tone === "neutral" && "bg-ink/[0.045] text-muted",
        tone === "strong" && "bg-ink/[0.07] font-medium text-ink",
        tone === "warning" && "bg-warning/[0.1] text-warning",
        tone === "danger" && "bg-danger/[0.08] text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Thin rounded bar; null = indeterminate. */
export function Bar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={clsx("h-[3px] w-full overflow-hidden rounded-full bg-ink/[0.07]", className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value === null ? (
        <div className="h-full w-1/3 animate-indeterminate rounded-full bg-ink/70" />
      ) : (
        <div className="h-full rounded-full bg-ink/70 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Disclosure */

/** A quiet "Advanced ›" toggle that reveals its children with a height transition. */
export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={clsx("h-4 w-4 transition-transform duration-150", open && "rotate-90")} strokeWidth={1.75} aria-hidden />
        {label}
      </button>
      <div className={clsx("ws-collapse grid", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} aria-hidden={!open}>
        <div className="min-h-0 overflow-hidden" {...(!open ? { inert: "" } : {})}>
          <div className="pt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Sheet */

/**
 * Floating panel on the right, inset from the window edges (a bottom sheet on phones).
 * Keeps the last content while animating closed.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="ws-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border border-b-0 border-ink/[0.07] bg-panel shadow-xl outline-none sm:inset-y-2 sm:left-auto sm:right-2 sm:max-h-none sm:w-[var(--w)] sm:max-w-[calc(100vw-16px)] sm:rounded-2xl sm:border-b"
          style={{ ["--w" as string]: `${width}px` }}
        >
          <div className="flex items-start gap-3 px-6 pb-2 pt-7 sm:px-8">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-xl font-normal text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="btn-ghost btn-icon -mr-2 -mt-1 h-8 w-8 shrink-0" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5 sm:px-8">{children}</div>
          {footer && <div className="flex flex-wrap items-center gap-2 px-6 pb-6 pt-2 sm:px-8">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Keep the last non-null value so a sheet can animate closed with its content. */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  useEffect(() => {
    if (value) setLast(value);
  }, [value]);
  return value ?? last;
}

/* ------------------------------------------------------------------ Modal + confirm */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 520,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="ws-dialog fixed left-1/2 top-[max(16px,10vh)] z-50 flex max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] flex-col rounded-2xl border border-ink/[0.07] bg-panel shadow-xl outline-none sm:max-h-[80vh]"
          style={{ maxWidth: width, transform: "translateX(-50%)" }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = e.currentTarget as HTMLElement;
            (root.querySelector<HTMLElement>("[data-autofocus],input:not([type=hidden]):not([type=file]),textarea") ?? root).focus();
          }}
          tabIndex={-1}
        >
          <div className="flex items-start gap-3 px-6 pb-1 pt-6">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-xl font-normal text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
            </div>
            <Dialog.Close className="btn-ghost btn-icon -mr-2 -mt-1 h-8 w-8 shrink-0" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-3">{children}</div>;
}

/** Names the thing, says what happens, focuses Cancel first. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-overlay fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Content
          role="alertdialog"
          className="ws-dialog fixed left-1/2 top-[max(16px,24vh)] z-[61] w-[calc(100vw-32px)] max-w-[420px] rounded-2xl border border-ink/[0.07] bg-panel shadow-xl outline-none"
          style={{ transform: "translateX(-50%)" }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
          }}
        >
          <div className="px-6 pb-5 pt-6">
            <Dialog.Title className="text-lg font-normal text-ink">{title}</Dialog.Title>
            {body ? <Dialog.Description className="mt-1.5 text-sm text-muted">{body}</Dialog.Description> : <Dialog.Description className="sr-only">Confirm</Dialog.Description>}
          </div>
          <div className="flex justify-end gap-2 px-6 pb-6">
            <Dialog.Close className="btn-secondary" data-cancel>
              Cancel
            </Dialog.Close>
            <button className="btn-danger-solid" onClick={onConfirm} disabled={busy}>
              {busy && <Spinner />}
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ Callout */

export function Callout({ tone = "neutral", title, children }: { tone?: "neutral" | "warning" | "danger"; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={clsx("rounded-lg px-4 py-3 text-sm", tone === "neutral" && "bg-ink/[0.03]", tone === "warning" && "bg-warning/[0.07]", tone === "danger" && "bg-danger/[0.06]")}>
      {title && <div className={clsx(tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink")}>{title}</div>}
      {children && <div className={clsx("text-muted", title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

/** Blue text link-button. */
export const linkClass = "text-sm text-accent underline-offset-4 transition-colors hover:underline focus-visible:underline";

/** Whole-window file drag tracking. Calls onDrop with the dropped files. */
export function useWindowFileDrop(onDrop: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) onDrop(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onDrop, enabled]);
  return dragging;
}
