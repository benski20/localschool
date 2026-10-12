import { Link } from "react-router-dom";
import { ArrowRight, BookOpenText, Mail, MessageSquareText, Mic, type LucideIcon } from "lucide-react";
import { ToolPage, Narrow } from "../../components/tools/ToolPage";
import { TOOL_PATHS, type ToolKey } from "../../lib/tools";

// Names match each tool page's title.
const CARDS: { tool: ToolKey; name: string; purpose: string; icon: LucideIcon }[] = [
  { tool: "meeting", name: "Meeting notes", purpose: "Record a meeting, get clean notes.", icon: Mic },
  { tool: "feedback", name: "Feedback", purpose: "Draft comments on student work.", icon: MessageSquareText },
  { tool: "adapt", name: "Adapt a reading", purpose: "Make a text easier or translate it.", icon: BookOpenText },
  { tool: "email", name: "Parent email", purpose: "Draft a note home to a family.", icon: Mail },
];

export function ToolsHome() {
  return (
    <ToolPage title="Tools" back={false} subtitle="Draft the routine writing, so you can get back to teaching.">
      <Narrow>
        <ul className="stagger grid auto-rows-fr gap-3 sm:grid-cols-2 sm:gap-4">
          {CARDS.map(({ tool, name, purpose, icon: Icon }) => (
            <li key={tool} className="flex">
              <Link
                to={TOOL_PATHS[tool]}
                className="card-interactive group flex w-full items-center gap-4 p-5 motion-safe:hover:-translate-y-px sm:flex-col sm:items-stretch sm:gap-0 sm:p-6"
              >
                <span className="flex shrink-0 items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-subtle text-muted transition-colors duration-fast group-hover:bg-accent-soft group-hover:text-accent">
                    <Icon className="h-[18px] w-[18px] stroke-[1.6]" aria-hidden />
                  </span>
                  <ArrowRight
                    className="mt-1 hidden h-4 w-4 text-faint sm:block opacity-0 transition-[opacity,transform] duration-fast motion-safe:-translate-x-1 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 sm:mt-10">
                  <span className="block text-lg leading-7 text-ink">{name}</span>
                  <span className="mt-0.5 block text-sm text-muted">{purpose}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Narrow>
    </ToolPage>
  );
}
