import { Fragment, type ReactNode } from "react";
import clsx from "clsx";
import type { Source } from "../lib/types";

/**
 * Small, safe renderer for model answers: paragraphs, lists, **bold**, `code`, and
 * [n] citation chips. No HTML is ever injected.
 */
export function Answer({
  text,
  sources,
  streaming,
  activeSource,
  onCite,
}: {
  text: string;
  sources: Source[];
  streaming?: boolean;
  activeSource?: number | null;
  onCite: (n: number) => void;
}) {
  const known = new Set(sources.map((s) => s.n));
  const blocks = parseBlocks(text);
  const inline = (s: string) => renderInline(s, known, activeSource ?? null, onCite);

  return (
    <div className="space-y-3 text-md leading-[26px] text-ink">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        const caret = streaming && last ? <Caret /> : null;
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={clsx("space-y-1.5 pl-5", b.ordered ? "list-decimal" : "list-disc", "marker:text-faint")}>
              {b.items.map((it, j) => (
                <li key={j} className="pl-1">
                  {inline(it)}
                  {last && j === b.items.length - 1 && caret}
                </li>
              ))}
            </Tag>
          );
        }
        if (b.type === "heading") {
          return (
            <h3 key={i} className="pt-1 text-base font-semibold text-ink">
              {inline(b.text)}
              {caret}
            </h3>
          );
        }
        return (
          <p key={i}>
            {inline(b.text)}
            {caret}
          </p>
        );
      })}
      {streaming && blocks.length === 0 && <Caret />}
    </div>
  );
}

function Caret() {
  return <span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] animate-blink bg-ink/70" aria-hidden />;
}

type Block = { type: "p"; text: string } | { type: "heading"; text: string } | { type: "list"; ordered: boolean; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const item = (bullet ?? numbered)![1];
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "list" && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading[1] });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function renderInline(text: string, known: Set<number>, active: number | null, onCite: (n: number) => void): ReactNode {
  // Tokens: **bold**, `code`, [n]
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g);
  return parts.map((part, i) => {
    if (!part) return null;
    const cite = part.match(/^\[(\d+)\]$/);
    if (cite) {
      const n = Number(cite[1]);
      if (!known.has(n)) return <Fragment key={i}>{part}</Fragment>;
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCite(n)}
          aria-label={`Show source ${n}`}
          className={clsx(
            "mx-[1px] inline-flex h-[18px] min-w-[18px] -translate-y-[1px] items-center justify-center rounded px-1 align-middle text-[11px] font-semibold tabular-nums transition-colors",
            active === n ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg",
          )}
        >
          {n}
        </button>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-subtle px-1 py-0.5 font-mono text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}
