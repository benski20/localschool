import { createContext, useContext } from "react";
import type { Theme } from "../../lib/theme";

export interface ShellState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  openPalette: () => void;
  openPassword: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside the app shell");
  return ctx;
}
