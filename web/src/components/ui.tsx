import clsx from "clsx";
import type { ReactNode } from "react";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded bg-subtle", className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-panel/60 to-transparent" />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <h1 className="text-xl text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel text-muted">{icon}</div>
      <h3 className="text-md font-medium text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-xs font-medium",
        tone === "neutral" && "bg-subtle text-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-danger/10 text-danger",
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "danger" && "bg-danger",
        tone === "neutral" && "bg-faint",
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value === null ? (
        <div className="h-full w-1/3 animate-indeterminate bg-accent/60" />
      ) : (
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, value)}%` }} />
      )}
    </div>
  );
}
