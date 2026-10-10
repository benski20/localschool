import { FileText, MessageSquare, Settings, Users, type LucideIcon } from "lucide-react";
import type { Role } from "../../lib/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ALL: (NavItem & { admin?: boolean })[] = [
  { to: "/chat", label: "Ask", icon: MessageSquare },
  { to: "/library", label: "Documents", icon: FileText },
  { to: "/roster", label: "Students", icon: Users },
  { to: "/admin", label: "Settings", icon: Settings, admin: true },
];

export const navFor = (role: Role | undefined): NavItem[] => ALL.filter((n) => !n.admin || role === "admin");
