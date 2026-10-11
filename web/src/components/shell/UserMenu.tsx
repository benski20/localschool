import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronsUpDown, Download, KeyRound, Laptop, LogOut, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { isDesktop } from "../../lib/shell";
import type { Theme } from "../../lib/theme";
import { useShell } from "./ShellContext";
import { useHealth } from "./health";

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-line bg-subtle font-mono font-medium text-muted"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.39) }}
    >
      {initials(name)}
    </span>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme, openPassword } = useShell();
  const health = useHealth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[data-item]") ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>("[data-item]")?.focus());
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!user) return null;
  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item =
    "flex h-9 w-full items-center gap-3 px-3 text-left text-sm text-muted outline-none transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle focus-visible:text-ink focus-visible:outline-none";

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        className="group flex h-11 w-full items-center gap-3 rounded-[2px] px-2 text-left transition-colors hover:bg-subtle aria-expanded:bg-subtle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.name} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{user.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-aria-expanded:opacity-100" aria-hidden />
      </button>

      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          className="ls-menu absolute bottom-full left-0 right-0 z-50 mb-2 border border-line bg-panel py-1.5 shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-line px-3 pb-3 pt-1.5">
            <Avatar name={user.name} size={32} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium text-ink">{user.name}</div>
              <div className="truncate text-xs text-faint">{user.email}</div>
            </div>
          </div>

          <div className="px-3 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Theme</div>
          <div className="mx-3 mb-2 grid grid-cols-3 border border-line" role="group" aria-label="Theme">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                data-item
                role="menuitemradio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={clsx(
                  "flex h-7 items-center justify-center gap-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 [&+&]:border-l [&+&]:border-line",
                  theme === value ? "bg-subtle text-ink" : "text-faint hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <button data-item role="menuitem" className={item} onClick={close(openPassword)}>
            <KeyRound className="h-4 w-4" strokeWidth={1.6} aria-hidden /> Change password
          </button>
          {!isDesktop && (
            <a data-item role="menuitem" className={item} href="/get">
              <Download className="h-4 w-4" strokeWidth={1.6} aria-hidden /> Get the Mac app
            </a>
          )}
          {!health?.local && (
            // In the Mac app this opens its "Keep my data on this Mac" screen; in a
            // browser it explains how (/get), since it needs the Mac app.
            <a data-item role="menuitem" className={item} href={isDesktop ? "teachersdesk://keep-on-mac" : "/get#keep"}>
              <Laptop className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden />
              <span className="min-w-0 truncate">Keep data on this Mac</span>
            </a>
          )}
          <a data-item role="menuitem" className={item} href="/privacy">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.6} aria-hidden /> Privacy
          </a>
          <div className="my-1.5 h-px bg-line" role="separator" />
          <button data-item role="menuitem" className={item} onClick={close(logout)}>
            <LogOut className="h-4 w-4" strokeWidth={1.6} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
