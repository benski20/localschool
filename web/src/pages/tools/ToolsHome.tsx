import { Link } from "react-router-dom";
import { ArrowRight, BookOpenText, Mail, MessageSquareText, Mic, type LucideIcon } from "lucide-react";
import { ToolPage, Narrow } from "../../components/tools/ToolPage";
import { TOOL_PATHS, type ToolKey } from "../../lib/tools";

const CARDS: { tool: ToolKey; name: string; purpose: string; icon: LucideIcon }[] = [
  { tool: "meeting", name: "Meeting notes", purpose: "Record a meeting, get clean notes.", icon: Mic },
  { tool: "feedback", name: "Feedback", purpose: "Draft comments on student work.", icon: MessageSquareText },
  { tool: "adapt", name: "Adapt a reading", purpose: "Make a text easier or translate it.", icon: BookOpenText },
  { tool: "email", name: "Parent email", purpose: "Draft a note home.", icon: Mail },
];

export function ToolsHome() {
  return (
    <ToolPage title="Tools" back={false}>
      <Narrow>
        <ul className="stagger grid gap-4 sm:grid-cols-2">
          {CARDS.map(({ tool, name, purpose, icon: Icon }) => (
            <li key={tool}>
              <Link to={TOOL_PATHS[tool]} className="card-interactive group grid h-full grid-cols-[auto_1fr] items-center gap-x-4 p-5 sm:flex sm:min-h-[184px] sm:flex-col sm:items-stretch sm:p-7">
                <span className="row-span-2 flex items-start justify-between sm:row-span-1">
                  <span className="flex h-10 w-10 items-center justify-center rounded border border-line text-muted transition-colors duration-fast group-hover:text-accent">
                    <Icon className="h-[18px] w-[18px] stroke-[1.5]" aria-hidden />
                  </span>
                  <ArrowRight
                    className="hidden h-4 w-4 -translate-x-1 text-faint opacity-0 sm:block transition-[opacity,transform] duration-fast group-hover:translate-x-0 group-hover:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="text-lg text-ink sm:mt-auto sm:pt-8">{name}</span>
                <span className="text-sm text-muted sm:mt-1">{purpose}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Narrow>
    </ToolPage>
  );
}
