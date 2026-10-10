import { BookOpen, MessageSquare, Settings2, Users, type LucideIcon } from "lucide-react";
import type { Role } from "../../lib/types";

export interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Second key of the "G then …" jump shortcut. */
  key: string;
  count?: "library" | "roster";
}

const ALL: (NavItem & { admin?: boolean })[] = [
  { to: "/chat", label: "Ask", hint: "Questions about your school and class", icon: MessageSquare, key: "A" },
  { to: "/library", label: "Library", hint: "School documents the assistant cites", icon: BookOpen, key: "L", count: "library" },
  { to: "/roster", label: "Roster", hint: "Your sections, plans and accommodations", icon: Users, key: "R", count: "roster" },
  { to: "/admin", label: "Admin", hint: "Runtime, models and people", icon: Settings2, key: "S", admin: true },
];

export const navFor = (role: Role | undefined): NavItem[] => ALL.filter((n) => !n.admin || role === "admin");

export const SHORTCUTS = {
  newQuestion: "C",
  toggleSidebar: "[",
} as const;
