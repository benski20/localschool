import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import clsx from "clsx";
import { CornerDownLeft, Download, KeyRound, LogOut, MessageSquare, Monitor, Moon, PanelLeft, Plus, Search, Sun } from "lucide-react";
import { api, relativeTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isDesktop } from "../lib/shell";
import type { ConversationSummary } from "../lib/types";
import { useShell } from "./shell/ShellContext";
import { navFor, SHORTCUTS } from "./shell/nav";

/** ⌘K: jump anywhere, start a question, change preferences. Opened by the shell. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [recent, setRecent] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const shell = useShell();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    api
      .get<{ conversations: ConversationSummary[] }>("/api/conversations")
      .then((r) => setRecent(r.conversations))
      .catch(() => undefined);
  }, [open]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const go = (path: string) => run(() => navigate(path));
  const nav = navFor(user?.role);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ls-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="ls-pop fixed left-1/2 top-[14vh] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[2px] border border-line-strong bg-panel focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Command label="Command menu" loop className="ls-cmdk">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-[18px] w-[18px] shrink-0 text-faint" strokeWidth={1.6} aria-hidden />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages, conversations and actions…"
                className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-faint focus:outline-none"
              />
              <kbd className="kbd hidden sm:inline-flex">esc</kbd>
            </div>

            <Command.List className="overflow-y-auto overscroll-contain pb-2">
              <Command.Empty className="flex flex-col items-center gap-1 px-3 py-10 text-center">
                <span className="text-sm font-medium text-ink">No matches</span>
                <span className="text-xs text-faint">Try a page name, or part of a past question.</span>
              </Command.Empty>

              <Command.Group heading="Actions">
                <Item icon={<Plus />} onSelect={() => go("/chat")} keys={[SHORTCUTS.newQuestion]} value="new question ask">
                  New question
                </Item>
                <Item icon={<PanelLeft />} onSelect={() => run(shell.toggleCollapsed)} keys={[SHORTCUTS.toggleSidebar]} value="toggle sidebar collapse expand" className="max-md:hidden">
                  {shell.collapsed ? "Expand sidebar" : "Collapse sidebar"}
                </Item>
              </Command.Group>

              <Command.Group heading="Go to">
                {nav.map(({ to, label, hint, icon: Icon, key }) => (
                  <Item key={to} icon={<Icon />} onSelect={() => go(to)} keys={["G", key]} hint={hint} value={`${label} ${hint}`}>
                    {label}
                  </Item>
                ))}
              </Command.Group>

              {recent.length > 0 && (
                <Command.Group heading="Recent conversations">
                  {recent.slice(0, 8).map((c) => (
                    <Item
                      key={c.id}
                      value={`conversation ${c.title} ${c.id}`}
                      icon={<MessageSquare />}
                      onSelect={() => go(`/chat/${c.id}`)}
                      meta={relativeTime(c.updated_at)}
                    >
                      <span className="truncate">{c.title}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Preferences">
                <Item icon={<Monitor />} value="theme system appearance" onSelect={() => run(() => shell.setTheme("system"))} meta={shell.theme === "system" ? "CURRENT" : undefined}>
                  Theme: match system
                </Item>
                <Item icon={<Sun />} value="theme light appearance" onSelect={() => run(() => shell.setTheme("light"))} meta={shell.theme === "light" ? "CURRENT" : undefined}>
                  Theme: light
                </Item>
                <Item icon={<Moon />} value="theme dark appearance" onSelect={() => run(() => shell.setTheme("dark"))} meta={shell.theme === "dark" ? "CURRENT" : undefined}>
                  Theme: dark
                </Item>
              </Command.Group>

              <Command.Group heading="Account">
                <Item icon={<KeyRound />} value="change password" onSelect={() => run(shell.openPassword)}>
                  Change password
                </Item>
                {!isDesktop && (
                  <Item icon={<Download />} value="get the mac app download install" onSelect={() => run(() => window.location.assign("/get"))}>
                    Get the Mac app
                  </Item>
                )}
                <Item icon={<LogOut />} value="sign out log out" onSelect={() => run(logout)}>
                  Sign out
                </Item>
              </Command.Group>
            </Command.List>

            <div className="flex h-10 items-center justify-between gap-3 border-t border-line px-4 text-xs text-faint">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <kbd className="kbd">↑</kbd>
                  <kbd className="kbd">↓</kbd> to navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="kbd">
                    <CornerDownLeft className="h-3 w-3" aria-hidden />
                  </kbd>{" "}
                  to open
                </span>
              </span>
              <span className="hidden truncate sm:inline">{user?.name}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({
  icon,
  children,
  onSelect,
  value,
  keys,
  hint,
  meta,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  value?: string;
  keys?: string[];
  hint?: string;
  meta?: string;
  className?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={clsx(
        "group relative flex h-10 cursor-pointer select-none items-center gap-3 px-3 text-[14px] text-muted transition-colors duration-75",
        "data-[selected=true]:bg-subtle data-[selected=true]:text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent data-[selected=true]:before:bg-accent",
        className,
      )}
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-faint transition-colors group-data-[selected=true]:text-accent [&>svg]:h-4 [&>svg]:w-4 [&>svg]:[stroke-width:1.6]">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate text-ink">{children}</span>
        {hint && <span className="hidden truncate text-xs text-faint sm:inline">{hint}</span>}
      </span>
      {meta && <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{meta}</span>}
      {keys && (
        <span className="hidden shrink-0 gap-1 sm:flex" aria-hidden>
          {keys.map((k) => (
            <kbd key={k} className="kbd">
              {k}
            </kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
