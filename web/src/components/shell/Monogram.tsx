import clsx from "clsx";

const SKIP = /^(the|a|an|of|and|at|for)$/i;

/** First letter of the first significant word: "The Shipley School" → "S". */
export function monogramLetter(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => !SKIP.test(w)) ?? words[0] ?? "";
  return (word.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();
}

/** A flat, near-square lettered tile generated from the school name (never a crest or logo). */
export function Monogram({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 select-none items-center justify-center rounded-[2px] bg-ink font-medium text-bg", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), lineHeight: 1, letterSpacing: "-0.02em" }}
    >
      {monogramLetter(name)}
    </span>
  );
}
