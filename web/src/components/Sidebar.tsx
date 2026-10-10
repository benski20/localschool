import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import { PRODUCT_NAME } from "../lib/brand";
import type { ConversationSummary } from "../lib/types";
import { Logo } from "./Logo";
import { DemoNotice } from "./DemoBanner";
import { useToast } from "./Toaster";
import { navFor } from "./shell/nav";
import { UserMenu } from "./shell/UserMenu";

export const CONVERSATIONS_CHANGED = "ls:conversations-changed";
const RECENT = 5;

/** Mark, one "New question" button, three or four places, a short Recent list, the account. */
export function Sidebar({ variant = "rail", onClose }: { variant?: "rail" | "drawer"; onClose?: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const drawer = variant === "drawer";

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

  return (
    <aside
      className={clsx("flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-panel", drawer ? "w-full" : "w-[244px]")}
      aria-label="Sidebar"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 pl-5 pr-2">
        <a href="/chat" onClick={(e) => (e.preventDefault(), navigate("/chat"))} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
          <Logo size={20} />
          <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
        </a>
        {drawer && (
          <button className="flex h-9 w-9 shrink-0 items-center justify-center text-muted hover:bg-subtle hover:text-ink" onClick={onClose} aria-label="Close navigation">
            <X className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pt-1">
        <button
          className="group flex h-9 w-full items-center gap-2 rounded-[2px] border border-line bg-panel px-3 text-sm text-ink transition-colors hover:border-line-strong hover:bg-subtle"
          onClick={() => {
            navigate("/chat");
            onClose?.();
          }}
        >
          <Plus className="h-4 w-4 text-muted group-hover:text-ink" strokeWidth={1.75} aria-hidden />
          New question
        </button>
      </div>

      <nav className="mt-5 shrink-0 space-y-px px-3" aria-label="Main">
        {navFor(user?.role).map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to || location.pathname.startsWith(to + "/");
          return (
            <NavLink
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group flex h-9 items-center gap-3 rounded-[2px] px-3 text-[14.5px] transition-colors duration-100",
                active ? "bg-subtle text-ink" : "text-muted hover:bg-subtle/60 hover:text-ink",
              )}
            >
              <Icon className={clsx("h-[17px] w-[17px] shrink-0", active ? "text-ink" : "text-faint group-hover:text-muted")} strokeWidth={1.6} aria-hidden />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <Recent conversations={conversations} onChanged={setConversations} />

      <div className="shrink-0 px-3 pb-3 pt-2">
        <Footnotes />
        <UserMenu />
      </div>
    </aside>
  );
}

/** Quiet footer lines that appear only when they matter. */
function Footnotes() {
  const { status } = useStatus();
  const { user } = useAuth();
  const offline = status?.runtime.state === "unreachable";
  const line = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
      Assistant offline
    </>
  );
  return (
    <div className="space-y-1.5 px-2 pb-2.5 empty:hidden">
      {offline &&
        (user?.role === "admin" ? (
          <NavLink to="/admin" role="status" className="flex items-center gap-2 text-[12.5px] text-muted hover:text-ink">
            {line}
          </NavLink>
        ) : (
          <div role="status" className="flex items-center gap-2 text-[12.5px] text-muted">
            {line}
          </div>
        ))}
      <DemoNotice />
    </div>
  );
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
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }

  const shown = (conversations ?? []).slice(0, RECENT);

  return (
    <div className="mt-8 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
      {shown.length > 0 && (
        <>
          <div className="px-3 pb-1.5 text-[12px] text-faint">Recent</div>
          <ul className="space-y-px">
            {shown.map((c) => {
              const isConfirming = confirming === c.id;
              return (
                <li key={c.id} className="group/item relative">
                  <NavLink
                    to={`/chat/${c.id}`}
                    title={c.title}
                    className={({ isActive }) =>
                      clsx(
                        "flex h-8 items-center rounded-[2px] pl-3 pr-9 text-[13.5px] transition-colors duration-100",
                        isActive ? "bg-subtle text-ink" : "text-muted hover:bg-subtle/60 hover:text-ink",
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    onBlur={() => isConfirming && setConfirming(null)}
                    aria-label={isConfirming ? `Confirm delete “${c.title}”` : `Delete “${c.title}”`}
                    title={isConfirming ? "Click again to delete" : "Delete"}
                    className={clsx(
                      "absolute right-1 top-1/2 flex h-6 -translate-y-1/2 items-center justify-center gap-1 rounded-[2px] text-[12px] transition-opacity duration-100",
                      isConfirming
                        ? "border border-danger/40 bg-panel px-1.5 text-danger opacity-100"
                        : "w-6 text-faint opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-60",
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    {isConfirming && "Delete"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
