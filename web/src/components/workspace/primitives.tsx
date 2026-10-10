/**
 * Shared building blocks for the workspace pages (Library, Roster, Admin).
 * Flat, square, hairline: radius 0–2px, no shadows, uppercase section labels,
 * status as uppercase colored text, blue only for links and mono step numbers.
 */
import "./workspace.css";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AlertTriangle, Check, Copy, Search, X } from "lucide-react";
import { Spinner } from "../ui";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/* ------------------------------------------------------------------ Page */

/** Page wrapper: sets the workspace scope and the canvas gutter. */
export function WorkspacePage({ children, width = 1200 }: { children: ReactNode; width?: number }) {
  return (
    <div className="ws-root mx-auto w-full px-4 pb-16 pt-7 sm:px-6 md:px-10 md:pt-12" style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

export function WorkspaceHeader({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="ws-rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] font-normal leading-9 tracking-[-0.015em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-[15px] leading-6 text-muted">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-faint">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Label({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "h2" | "h3" | "dt" | "span" }) {
  return <As className={clsx("ws-label", className)}>{children}</As>;
}

/** Bordered frame with a main pane and an optional right rail on subtle gray. */
export function Frame({ children, rail, railWidth = 320, className }: { children: ReactNode; rail?: ReactNode; railWidth?: number; className?: string }) {
  return (
    <div
      className={clsx("ws-rise grid border border-line bg-panel", rail && "lg:grid-cols-[minmax(0,1fr)_var(--rail)]", className)}
      style={{ ["--rail" as string]: `${railWidth}px`, animationDelay: "40ms" }}
    >
      <div className="min-w-0">{children}</div>
      {rail && <aside className="min-w-0 border-t border-line bg-bg px-5 py-6 lg:border-l lg:border-t-0 lg:px-6">{rail}</aside>}
    </div>
  );
}

export function RailSection({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("[&+&]:mt-8", className)}>
      <Label as="h2" className="mb-3">
        {label}
      </Label>
      {children}
    </section>
  );
}

/** Numbered "what happens" list with mono step numbers in accent. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="space-y-4">
      {items.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
          <span className="pt-px font-mono text-[12px] leading-5 text-accent">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <div className="text-sm font-medium text-ink">{s.title}</div>
            <div className="mt-0.5 text-[13px] leading-5 text-muted">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ Search */

export const SearchField = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; placeholder: string; label: string; shortcut?: string; className?: string }
>(function SearchField({ value, onChange, placeholder, label, shortcut = "/", className }, ref) {
  return (
    <div className={clsx("group relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint transition-colors group-focus-within:text-ink" aria-hidden />
      <input
        ref={ref}
        className="input h-8 pl-8 pr-9 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            else (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-faint transition-colors hover:text-ink"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden>
          {shortcut}
        </span>
      )}
    </div>
  );
});

/** Run `run` when a single-key shortcut is pressed outside a text field or dialog. */
export function useKeyShortcut(key: string, run: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role=dialog],[role=alertdialog]")) return;
      if (e.key === key) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, run, enabled]);
}

/* ------------------------------------------------------------------ Tabs */

export interface Segment<T extends string | number> {
  id: T;
  label: ReactNode;
  count?: number;
}

/** Flat text tabs with an ink underline (page sub-navigation and filters). */
export function Tabs<T extends string | number>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Segment<T>[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx("-mb-px flex max-w-full gap-5 overflow-x-auto [scrollbar-width:none]", className)}>
      {items.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={String(t.id)}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={clsx(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b pb-3 pt-1 text-sm transition-colors duration-150",
              on ? "border-ink text-ink" : "border-transparent text-faint hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={clsx("font-mono text-[11px]", on ? "text-muted" : "text-faint")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Square segmented filter: a hairline box split into cells. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Segment<T>[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx("inline-flex max-w-full overflow-x-auto border border-line bg-panel [scrollbar-width:none]", className)}>
      {items.map((t, i) => {
        const on = value === t.id;
        return (
          <button
            key={String(t.id)}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={clsx(
              "inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] transition-colors duration-150 sm:px-3",
              i > 0 && "border-l border-line",
              on ? "bg-subtle text-ink" : "text-muted hover:bg-subtle/50 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={clsx("font-mono text-[11px]", on ? "text-muted" : "text-faint")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Chips & status */

/** Rectangular outlined chip (accommodations, plan types, tags). */
export function Chip({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex h-[22px] max-w-full items-center gap-1 whitespace-nowrap rounded-[2px] border bg-panel px-1.5 text-xs",
        tone === "neutral" && "border-line text-muted",
        tone === "accent" && "border-line-strong text-ink",
        tone === "success" && "border-success/30 text-success",
        tone === "warning" && "border-warning/30 text-warning",
        tone === "danger" && "border-danger/30 text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Uppercase colored status text (INDEXED / PROCESSING / FAILED). */
export function StatusText({ tone, children, className, title }: { tone: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "ws-status inline-flex items-center gap-1.5",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "accent" && "text-accent",
        tone === "neutral" && "text-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
      <span
        className={clsx(
          "relative h-1.5 w-1.5 rounded-full",
          pulse && "ws-pulse",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "danger" && "bg-danger",
          tone === "accent" && "bg-accent",
          tone === "neutral" && "bg-faint",
        )}
      />
    </span>
  );
}

/** Initials in a square hairline tile, generated from a name. */
export function Monogram({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-[2px] border border-line bg-bg font-medium text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ Numbers */

/** A label over a mono figure, for rails and stat rows. */
export function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[13px] text-faint">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5">
        <span className={clsx("font-mono text-[20px] leading-7 tracking-tight", tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-ink")}>{value}</span>
        {hint && <span className="truncate text-xs text-faint">{hint}</span>}
      </dd>
    </div>
  );
}

/** Key/value rows separated by hairlines. Values in mono when numeric. */
export function DetailList({ items, className }: { items: { label: string; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={clsx("divide-y divide-line border-y border-line", className)}>
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
          <dt className="shrink-0 text-faint">{i.label}</dt>
          <dd className={clsx("min-w-0 truncate text-right text-ink", i.mono && "font-mono text-[13px]")}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ Settings rows */

export function SettingsGroup({ label, title, description, children, footer, className }: { label?: string; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={clsx("border border-line bg-panel", className)}>
      {(label || title || description) && (
        <div className="px-6 pb-2 pt-6">
          {label && <Label className="mb-1.5">{label}</Label>}
          {title && <h2 className="text-[19px] font-normal leading-7 tracking-[-0.01em] text-ink">{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-line px-6">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
    </section>
  );
}

export function SettingsRow({ label, hint, htmlFor, children, align = "center" }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; align?: "center" | "start" }) {
  return (
    <div className={clsx("grid gap-2.5 py-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:gap-10", align === "center" ? "md:items-center" : "md:items-start")}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[13px] leading-5 text-faint">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ Copy */

export function CopyButton({ text, className, label = "Copy" }: { text: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={clsx("btn-secondary shrink-0 gap-1.5", className)}
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
      }
      aria-live="polite"
    >
      <span className="relative inline-flex h-3.5 w-3.5">
        <Copy className={clsx("absolute h-3.5 w-3.5 transition-opacity duration-150", copied ? "opacity-0" : "opacity-100")} aria-hidden />
        <Check className={clsx("absolute h-3.5 w-3.5 text-success transition-opacity duration-150", copied ? "opacity-100" : "opacity-0")} aria-hidden />
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

/* ------------------------------------------------------------------ Sheet (side drawer) */

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  header,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="ws-sheet ws-layer fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col border-t border-line bg-panel outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[var(--w)] sm:max-w-full sm:border-l sm:border-t-0"
          style={{ ["--w" as string]: `${width}px` }}
        >
          <div className="flex items-start gap-3 border-b border-line px-6 pb-5 pt-6">
            <div className="min-w-0 flex-1">
              {header}
              <Dialog.Title className="text-[22px] font-normal leading-8 tracking-[-0.01em] text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="btn-ghost -mr-2 -mt-1 h-8 w-8 shrink-0 px-0" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
          {footer && <div className="flex items-center gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ Modal + confirm */

export function Modal({
  open,
  onOpenChange,
  label,
  title,
  description,
  children,
  width = 560,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  label?: string;
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
          className="ws-dialog ws-layer fixed left-1/2 top-[max(16px,8vh)] z-50 flex max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] flex-col border border-line bg-panel outline-none sm:top-[10vh] sm:max-h-[82vh]"
          style={{ maxWidth: width, transform: "translateX(-50%)" }}
          onOpenAutoFocus={(e) => {
            // Focus the first field rather than the close button.
            e.preventDefault();
            const root = e.currentTarget as HTMLElement;
            (root.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select") ?? root).focus();
          }}
          tabIndex={-1}
        >
          <div className="flex items-start gap-3 px-6 pb-2 pt-6">
            <div className="min-w-0 flex-1">
              {label && <Label className="mb-1.5">{label}</Label>}
              <Dialog.Title className="text-[22px] font-normal leading-8 tracking-[-0.01em] text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
            </div>
            <Dialog.Close className="btn-ghost -mr-2 -mt-1 h-8 w-8 shrink-0 px-0" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalFooter({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
      {hint && <div className="mr-auto hidden text-[13px] text-faint sm:block">{hint}</div>}
      {children}
    </div>
  );
}

/** Solid danger button (square, flat). */
export const dangerButton =
  "inline-flex h-8 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] bg-danger px-3 text-sm font-medium text-panel transition-colors duration-150 hover:bg-danger/90 disabled:pointer-events-none disabled:opacity-50";

/** Quiet danger: hairline outline, red text. For row-level destructive entry points. */
export const dangerQuiet =
  "inline-flex h-8 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] border border-line bg-panel px-3 text-sm font-medium text-danger transition-colors duration-150 hover:border-danger/40 hover:bg-danger/[0.04] disabled:pointer-events-none disabled:opacity-50";

/** A destructive confirmation: names the thing, explains consequences, focuses Cancel first. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
  kicker = "Destructive action",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  kicker?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-overlay fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Content
          role="alertdialog"
          className="ws-dialog ws-layer fixed left-1/2 top-[max(16px,22vh)] z-[61] w-[calc(100vw-32px)] max-w-[440px] border border-line bg-panel outline-none"
          style={{ transform: "translateX(-50%)" }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
          }}
        >
          <div className="px-6 pb-5 pt-6">
            <div className="ws-status mb-2 inline-flex items-center gap-1.5 text-danger">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {kicker}
            </div>
            <Dialog.Title className="text-[19px] font-normal leading-7 text-ink">{title}</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-muted">{body}</Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <Dialog.Close className="btn-secondary" data-cancel>
              Cancel
            </Dialog.Close>
            <button className={dangerButton} onClick={onConfirm} disabled={busy}>
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

export function Callout({ tone = "neutral", icon, title, children, action }: { tone?: Tone; icon?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex items-start gap-3 border bg-panel px-4 py-3 text-sm",
        tone === "neutral" && "border-line",
        tone === "accent" && "border-line",
        tone === "success" && "border-success/30",
        tone === "warning" && "border-warning/30",
        tone === "danger" && "border-danger/30",
      )}
    >
      {icon && (
        <span
          className={clsx(
            "mt-0.5 shrink-0",
            (tone === "neutral" || tone === "accent") && "text-faint",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className={clsx("text-muted", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Thin square linear bar; null = indeterminate. */
export function Bar({ value, tone = "ink", className }: { value: number | null; tone?: "ink" | "success" | "warning"; className?: string }) {
  const fill = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-ink";
  return (
    <div className={clsx("h-[3px] w-full overflow-hidden bg-line", className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value === null ? (
        <div className={clsx("h-full w-1/3 animate-indeterminate", fill)} />
      ) : (
        <div className={clsx("h-full transition-[width] duration-500 ease-out", fill)} style={{ width: `${Math.max(1.5, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}

/** Blue text link-button (the only blue in the UI besides step numbers). */
export const linkClass = "text-sm text-accent underline-offset-4 transition-colors hover:underline focus-visible:underline";
