import clsx from "clsx";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

// Content widths 720 / 880 / 1040 plus the 2×32px gutter.
const WIDTHS = { narrow: "max-w-[784px]", medium: "max-w-[944px]", wide: "max-w-[1104px]" } as const;

/** One calm, centered tool screen: title, inputs, one primary button, the result, then Recent. */
export function ToolPage({
  title,
  subtitle,
  back = true,
  width = "narrow",
  children,
}: {
  title: string;
  /** One quiet line under the title: what this tool does. */
  subtitle?: ReactNode;
  back?: boolean;
  /** medium/wide for side-by-side results; everything stays aligned to one left edge. */
  width?: keyof typeof WIDTHS;
  children: ReactNode;
}) {
  return (
    <div className={clsx("mx-auto w-full px-4 pb-24 pt-8 sm:px-8 sm:pt-12", WIDTHS[width])}>
      <div>
        {back && <BackLink />}
        <h1 className={clsx("font-serif text-[32px] leading-[40px] tracking-[-0.01em] text-ink sm:text-[36px] sm:leading-[44px]", back && "mt-5")}>
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
      </div>
      <div className="mt-10 space-y-10">{children}</div>
    </div>
  );
}

/** The quiet "← Tools" link above every tool's title. */
export function BackLink({ to = "/tools", label = "Tools" }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-sm text-faint transition-colors hover:text-ink">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  );
}

/** A small pill for metadata (date, student, type). A button when it has `onClick`. */
export function Chip({ children, className, ...rest }: { children: ReactNode; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel px-3 text-sm text-muted";
  if (!rest.onClick) return <span className={clsx(base, className)}>{children}</span>;
  return (
    <button type="button" {...rest} className={clsx(base, "transition-colors hover:border-line-strong hover:text-ink", className)}>
      {children}
    </button>
  );
}

export function Narrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("w-full max-w-[720px]", className)}>{children}</div>;
}

/** A row of mutually exclusive choices. "segmented" for 2–3 short options; "chips" wrap on narrow screens. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "segmented",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: "segmented" | "chips";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={variant === "chips" ? "flex flex-wrap gap-2" : "segmented"}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(variant === "chips" && "chip")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Form label above a control, with an optional quiet "Optional". */
export function Labelled({ label, optional, htmlFor, children, className }: { label: string; optional?: boolean; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="field-label flex items-baseline gap-2">
        {label}
        {optional && <span className="text-xs font-normal text-faint">Optional</span>}
      </label>
      {children}
    </div>
  );
}

/** Inline error line, quiet. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="animate-fade-in text-sm text-danger">
      {children}
    </p>
  );
}

/**
 * Wraps a result that sits under the form: when `id` changes (a draft was just made or reopened
 * from Recent), bring it into view if it starts below the fold.
 */
export function Reveal({ id, children }: { id: number | string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (id === null || !el) return;
    const t = window.setTimeout(() => {
      if (el.getBoundingClientRect().top > window.innerHeight * 0.6) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [id]);
  return (
    <div ref={ref} className="scroll-mt-8">
      {children}
    </div>
  );
}

/** Read a dropped/chosen text file in the browser when we can; otherwise the server extracts it. */
export const isPlainText = (f: File) => f.type.startsWith("text/") || /\.(txt|md)$/i.test(f.name);
