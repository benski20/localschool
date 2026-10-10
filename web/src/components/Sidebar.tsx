import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { BookOpen, LogOut, MessageSquare, Monitor, Moon, Plus, Settings2, Sun, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import { useTheme, type Theme } from "../lib/theme";
import type { ConversationSummary } from "../lib/types";
import { StatusPill } from "./StatusPill";
import { Logo } from "./Logo";

export const CONVERSATIONS_CHANGED = "ls:conversations-changed";

export function Sidebar() {
  const { user, logout } = useAuth();
  const { status } = useStatus();
  const [theme, setTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .get<{ conversations: ConversationSummary[] }>("/api/conversations")
        .then((r) => setConversations(r.conversations))
        .catch(() => setConversations([]));
    load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, []);

  const nav = [
    { to: "/chat", label: "Ask", icon: MessageSquare },
    { to: "/library", label: "Library", icon: BookOpen },
    { to: "/roster", label: "Roster", icon: Users },
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: Settings2 }] : []),
  ];
  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-ink">{status?.school && status.school !== "Local School" ? status.school : "Local School"}</div>
          <div className="truncate text-xs text-faint">Private AI for your school</div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <button className="btn-secondary w-full justify-between" onClick={() => navigate("/chat")}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden /> New question
          </span>
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <nav className="space-y-0.5 px-3" aria-label="Main">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                isActive || (to === "/chat" && location.pathname.startsWith("/chat"))
                  ? "bg-panel text-ink shadow-card"
                  : "text-muted hover:bg-subtle hover:text-ink",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
        <div className="eyebrow px-2.5 pb-1.5">Recent</div>
        {conversations === null ? null : conversations.length === 0 ? (
          <p className="px-2.5 text-sm text-faint">Your questions will appear here.</p>
        ) : (
          <ul className="space-y-px">
            {conversations.map((c) => (
              <li key={c.id}>
                <NavLink
                  to={`/chat/${c.id}`}
                  className={({ isActive }) =>
                    clsx(
                      "block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      isActive ? "bg-subtle text-ink" : "text-muted hover:bg-subtle hover:text-ink",
                    )
                  }
                  title={c.title}
                >
                  {c.title}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <StatusPill />
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-muted">
            {initials(user?.name ?? "")}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
            <div className="truncate text-xs capitalize text-faint">{user?.role}</div>
          </div>
          <button
            className="btn-ghost h-7 w-7 px-0"
            onClick={() => setTheme(nextTheme[theme])}
            aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}`}
            title={`Theme: ${theme}`}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button className="btn-ghost h-7 w-7 px-0" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
