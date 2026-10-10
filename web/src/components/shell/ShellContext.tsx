import { createContext, useContext } from "react";
import type { Theme } from "../../lib/theme";

export interface ShellState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  openPalette: () => void;
  openPassword: () => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
  counts: { library: number | null; roster: number | null };
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside the app shell");
  return ctx;
}

/** True when a key event is aimed at something the user is typing into. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** Platform modifier label for shortcut hints. */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
