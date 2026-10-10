import clsx from "clsx";
import { PRODUCT_NAME } from "../lib/brand";

/**
 * Product mark: line-art teacher's desk (top, drawer pedestal, leg) with an answer bubble above.
 * Drawn in currentColor (ink by default), hairline-weight, no tile. Neutral, never school-branded.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={size < 24 ? 1.8 : 1.6}
      strokeLinejoin="round"
      aria-hidden
      className={clsx("shrink-0 text-ink", className)}
    >
      <path d="M8.5 4.5h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H14l-3.5 3v-3h-2a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
      <path d="M11.5 9.5h9" />
      <path d="M2.5 21.5h27" />
      <path d="M5.5 21.5v7h8v-7" />
      <path d="M8 25h3" />
      <path d="M26.5 21.5v7" />
    </svg>
  );
}

/** Mark + product name, for headers and sign-in. */
export function ProductLockup({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <span className="text-base font-normal tracking-tight text-ink">{PRODUCT_NAME}</span>
    </span>
  );
}

/** First meaningful letter of a name: "The Shipley School" → "S". */
export function monogramLetter(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => !/^(the|a|an)$/i.test(w)) ?? words[0] ?? "";
  return (word.match(/\p{L}|\p{N}/u)?.[0] ?? "·").toUpperCase();
}

/**
 * The school's monogram, generated from its name (no crests or trademarked marks):
 * the initial in a hairline square.
 */
export function SchoolMonogram({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 select-none items-center justify-center rounded-sm border border-line-strong bg-panel font-normal text-ink", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), letterSpacing: "-0.02em" }}
    >
      {monogramLetter(name)}
    </span>
  );
}
