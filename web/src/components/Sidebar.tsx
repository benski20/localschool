import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PRODUCT_NAME } from "../lib/brand";
import type { ConversationSummary } from "../lib/types";
import { Logo } from "./Logo";
import { useToast } from "./Toaster";
import { useShell } from "./shell/ShellContext";
import { navFor, SHORTCUTS } from "./shell/nav";
import { UserMenu } from "./shell/UserMenu";
import { StatusMeta } from "./shell/TopBar";
import { Skeleton } from "./ui";

export const CONVERSATIONS_CHANGED = "ls:conversations-changed";

/** Tiny uppercase tracked group label. */
function GroupLabel({ children, className }: { children: string; className?: string }) {
  return <div className={clsx("px-4 pb-2 text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-faint", className)}>{children}</div>;
}

export function Sidebar({ variant = "rail", onClose }: { variant?: "rail" | "drawer"; onClose?: () => void }) {
  const { user } = useAuth();
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const compact = variant === "rail" && shell.collapsed;
  const touch = variant === "drawer";

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

  const nav = navFor(user?.role);

  return (
    <aside
      className="ls-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-panel"
      style={variant === "rail" ? { width: compact ? 56 : 248 } : { width: "100%" }}
      aria-label="Sidebar"
    >
      {/* Product mark */}
      <div className={clsx("flex h-14 shrink-0 items-center border-b border-line", compact ? "justify-center" : "gap-3 pl-4 pr-2")}>
        <a href="/chat" onClick={(e) => (e.preventDefault(), navigate("/chat"))} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${PRODUCT_NAME} home`}>
          <Logo size={compact ? 24 : 22} />
          {!compact && <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>}
        </a>
        {touch && (
          <button className="flex h-9 w-9 shrink-0 items-center justify-center text-muted hover:bg-subtle hover:text-ink" onClick={onClose} aria-label="Close navigation">
            <X className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {/* New question */}
      <div className={clsx("shrink-0 pt-4", compact ? "px-2" : "px-4")}>
        <button
          className={clsx(
            "group flex w-full items-center border border-line bg-panel text-sm text-ink transition-colors hover:border-line-strong hover:bg-subtle",
            compact ? "h-10 justify-center" : "h-9 gap-2 px-3",
          )}
          onClick={() => navigate("/chat")}
          aria-label="New question"
          title={compact ? `New question  ${SHORTCUTS.newQuestion}` : undefined}
        >
          <Plus className="h-4 w-4 text-muted group-hover:text-ink" strokeWidth={1.75} aria-hidden />
          {!compact && (
            <>
              <span className="flex-1 text-left">New question</span>
              {!touch && <kbd className="kbd">{SHORTCUTS.newQuestion}</kbd>}
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={clsx("mt-6 shrink-0", compact && "mt-4")} aria-label="Main">
        {!compact && <GroupLabel>Workspace</GroupLabel>}
        <div className={clsx("space-y-px", compact ? "px-2" : "pr-3")}>
          {nav.map(({ to, label, icon: Icon, key, count }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + "/");
            const n = count ? shell.counts[count] : null;
            return (
              <NavLink
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                title={compact ? `${label}  G ${key}` : undefined}
                className={clsx(
                  "group relative flex items-center text-[15px] transition-colors duration-100",
                  compact ? "h-10 justify-center" : "h-10 gap-3 pl-4 pr-3",
                  active ? "bg-subtle text-ink" : "text-muted hover:bg-subtle/60 hover:text-ink",
                )}
              >
                <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "text-faint group-hover:text-muted")} strokeWidth={1.6} aria-hidden />
                {!compact && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    <span className="relative flex h-5 items-center">
                      {n !== null && n !== undefined && (
                        <span className={clsx("font-mono text-xs tabular-nums text-faint transition-opacity duration-100", !touch && "group-hover:opacity-0")}>{n}</span>
                      )}
                      {!touch && (
                        <span className="absolute right-0 flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100" aria-hidden>
                          <kbd className="kbd">G</kbd>
                          <kbd className="kbd">{key}</kbd>
                        </span>
                      )}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Recent conversations */}
      {compact ? <div className="flex-1" /> : <Recent conversations={conversations} onChanged={setConversations} />}

      {/* Account */}
      <div className={clsx("shrink-0 border-t border-line", compact ? "p-2" : "px-2 py-2")}>
        {touch && (
          <div className="px-2 pb-2 pt-1 text-xs [&_span]:!text-xs">
            <StatusMeta />
          </div>
        )}
        <UserMenu compact={compact} />
      </div>
    </aside>
  );
}

/* ---------- recent conversations ---------- */

function parseTime(iso: string) {
  return new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").getTime();
}

function compactTime(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Recent({ conversations, onChanged }: { conversations: ConversationSummary[] | null; onChanged: (c: ConversationSummary[]) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    if (confirming === null) return;
    const id = window.setTimeout(() => setConfirming(null), 3000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  async function remove(c: ConversationSummary) {
    if (confirming !== c.id) {
      setConfirming(c.id);
      return;
    }
    setConfirming(null);
    try {
      await api.del(`/api/conversations/${c.id}`);
      onChanged((conversations ?? []).filter((x) => x.id !== c.id));
      if (location.pathname === `/chat/${c.id}`) navigate("/chat");
      window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
      toast({ kind: "success", message: "Conversation deleted." });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }

  const now = Date.now();

  return (
    <div className="mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
      <GroupLabel className="sticky top-0 z-[1] bg-panel">Recent</GroupLabel>
      {conversations === null ? (
        <div className="space-y-3 px-4 pt-1" aria-hidden>
          {[72, 88, 60, 80].map((w) => (
            <div key={w} style={{ width: `${w}%` }}>
              <Skeleton className="h-3" />
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <p className="px-4 text-sm text-faint">Your questions will collect here, newest first.</p>
      ) : (
        <ul className="pr-3">
          {conversations.map((c) => {
            const t = parseTime(c.updated_at);
            const isConfirming = confirming === c.id;
            return (
              <li key={c.id} className="group/item relative">
                <NavLink
                  to={`/chat/${c.id}`}
                  title={c.title}
                  className={({ isActive }) =>
                    clsx(
                      "flex h-8 items-center pl-4 pr-10 text-[13.5px] transition-colors duration-100",
                      isActive ? "bg-subtle text-ink" : "text-muted hover:bg-subtle/60 hover:text-ink",
                    )
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                </NavLink>
                <span
                  className={clsx(
                    "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-faint transition-opacity duration-100",
                    isConfirming ? "opacity-0" : "group-focus-within/item:opacity-0 group-hover/item:opacity-0",
                  )}
                  aria-hidden
                >
                  {compactTime(t, now)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  onBlur={() => isConfirming && setConfirming(null)}
                  aria-label={isConfirming ? `Confirm delete “${c.title}”` : `Delete “${c.title}”`}
                  title={isConfirming ? "Click again to delete" : "Delete"}
                  className={clsx(
                    "absolute right-1.5 top-1/2 flex h-6 -translate-y-1/2 items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] transition-opacity duration-100",
                    isConfirming
                      ? "border border-danger/40 bg-panel px-1.5 text-danger opacity-100"
                      : "w-6 text-faint opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/item:opacity-100",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {isConfirming && "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
