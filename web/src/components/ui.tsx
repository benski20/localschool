import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

/** Shimmering placeholder. Prefer these over spinners for anything with a known shape. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={clsx("skeleton", className)} style={style} aria-hidden />;
}

/** A few lines of text-shaped skeleton; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2.5", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 ? "62%" : `${96 - i * 4}%` }} />
      ))}
    </div>
  );
}

/** Page title block: regular-weight 28px title, grey description, optional uppercase eyebrow. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("flex animate-fade-in flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-8", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="label mb-3">{eyebrow}</div>}
        <h1 className="text-2xl font-normal text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-md text-muted text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex animate-fade-in flex-col items-center justify-center rounded border border-line bg-panel px-6 py-16 text-center", className)}>
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded border border-line text-muted [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.5]">
        {icon}
      </div>
      <h3 className="text-lg font-normal text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted text-pretty">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/**
 * Status as UPPERCASE coloured text ("CERTIFIED"), no pill. variant="box" adds a hairline
 * square outline in the same colour, for tags that need a boundary in dense rows.
 */
export function Badge({
  children,
  tone = "neutral",
  dot,
  variant = "text",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /** Leading status dot in the badge's colour. */
  dot?: boolean;
  variant?: "text" | "box";
  className?: string;
}) {
  return (
    <span
      className={clsx("status-text", `status-${tone}`, variant === "box" && "h-5 rounded-sm border px-1.5", className)}
      style={variant === "box" ? { borderColor: "color-mix(in srgb, currentColor 30%, transparent)" } : undefined}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Same as Badge, by the name the design language uses. */
export const StatusText = Badge;

export function Dot({ tone, pulse }: { tone: "success" | "warning" | "danger" | "neutral" | "accent"; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success text-success/40",
        tone === "warning" && "bg-warning text-warning/40",
        tone === "danger" && "bg-danger text-danger/40",
        tone === "accent" && "bg-accent text-accent/40",
        tone === "neutral" && "bg-faint text-faint/40",
        pulse && "animate-pulse-ring",
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("h-4 w-4 animate-spin [animation-duration:800ms]", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
  error,
  optional,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  /** Replaces the hint, in danger colour. */
  error?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="field-label flex items-baseline justify-between gap-2" htmlFor={htmlFor}>
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-faint">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 animate-fade-in text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs leading-[18px] text-faint">{hint}</p>
      )}
    </div>
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div
      className={clsx("h-0.5 w-full overflow-hidden bg-ink/[0.08]", className)}
      role="progressbar"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {value === null ? (
        <div className="h-full w-1/3 animate-indeterminate bg-ink/60" />
      ) : (
        <div className="h-full bg-ink transition-[width] duration-slow ease-out" style={{ width: `${Math.max(2, value)}%` }} />
      )}
    </div>
  );
}

/** Keyboard shortcut. <Kbd>⌘K</Kbd> or <Kbd keys={["⌘", "K"]} />. */
export function Kbd({ children, keys, className }: { children?: ReactNode; keys?: string[]; className?: string }) {
  if (keys)
    return (
      <span className={clsx("inline-flex items-center gap-0.5", className)}>
        {keys.map((k) => (
          <kbd key={k} className="kbd">
            {k}
          </kbd>
        ))}
      </span>
    );
  return <kbd className={clsx("kbd", className)}>{children}</kbd>;
}

/** Initials in a hairline square. */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 select-none items-center justify-center rounded-sm border border-line bg-subtle font-medium text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials}
    </span>
  );
}

/** Tiny uppercase tracked section label ("SAVED RUNS"). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("label", className)}>{children}</div>;
}

/** Section heading inside a page: regular-weight title + optional description/actions. */
export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-normal text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Numbered "what happens" list: mono blue numerals (01, 02…), regular title, grey body. */
export function Steps({ items, className }: { items: { title: ReactNode; body?: ReactNode }[]; className?: string }) {
  return (
    <ol className={clsx("space-y-5", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-4">
          <span className="step-num w-6 shrink-0 pt-px">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <div className="text-base text-ink">{it.title}</div>
            {it.body && <div className="mt-0.5 text-sm leading-[22px] text-muted">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
