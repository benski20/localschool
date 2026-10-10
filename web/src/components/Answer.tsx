import { Fragment, type ReactNode } from "react";
import type { Source } from "../lib/types";
import { CitationChip } from "./chat/Citation";
import "./chat/chat.css";

/**
 * Small, safe renderer for model answers: paragraphs, headings, lists, tables,
 * quotes, **bold**, *italic*, `code`, and [n] citation chips. No HTML is ever injected.
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
  const byN = new Map(sources.map((s) => [s.n, s]));
  // While streaming, hide a half-arrived citation like "[1" so it never flashes as raw text.
  const shown = streaming ? text.replace(/\[\d*$/, "") : text;
  const blocks = parseBlocks(shown);
  const inline = (s: string) => renderInline(s, byN, activeSource ?? null, onCite);
  const caret = <span className="chat-caret" aria-hidden />;

  return (
    <div className="chat-prose" aria-busy={streaming || undefined}>
      {blocks.map((b, i) => {
        const tail = streaming && i === blocks.length - 1 ? caret : null;
        switch (b.type) {
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    {inline(it)}
                    {j === b.items.length - 1 && tail}
                  </li>
                ))}
              </Tag>
            );
          }
          case "heading": {
            const Tag = (["h2", "h2", "h3", "h4"] as const)[Math.min(b.level, 4) - 1];
            return (
              <Tag key={i}>
                {inline(b.text)}
                {tail}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={i}>
                {inline(b.text)}
                {tail}
              </blockquote>
            );
          case "hr":
            return <hr key={i} />;
          case "table":
            return (
              <div key={i} className="chat-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j}>{inline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {b.head.map((_, k) => (
                          <td key={k}>{inline(r[k] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i}>
                {inline(b.text)}
                {tail}
              </p>
            );
        }
      })}
      {streaming && blocks.length === 0 && caret}
    </div>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isDivider = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }
    // Table: header row, divider row, then body rows.
    if (line.startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1].trim())) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++].trim()));
      i--;
      blocks.push({ type: "table", head, rows });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
    } else if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const item = (bullet ?? numbered)![1];
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "list" && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
    } else if (quote) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "quote") prev.text += " " + quote[1];
      else blocks.push({ type: "quote", text: quote[1] });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function renderInline(text: string, byN: Map<number, Source>, active: number | null, onCite: (n: number) => void): ReactNode {
  // Tokens: **bold**, *italic*, `code`, [n]
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\d+\])/g);
  return parts.map((part, i) => {
    if (!part) return null;
    const cite = part.match(/^\[(\d+)\]$/);
    if (cite) {
      const s = byN.get(Number(cite[1]));
      if (!s) return <Fragment key={i}>{part}</Fragment>;
      return <CitationChip key={i} source={s} active={active === s.n} onOpen={onCite} />;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
