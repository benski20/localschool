import { Link } from "react-router-dom";
import clsx from "clsx";
import { Menu, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useStatus } from "../../lib/status";
import { PRODUCT_NAME } from "../../lib/brand";
import { Logo } from "../Logo";
import { schoolName } from "./health";
import { MOD, useShell } from "./ShellContext";
import { SHORTCUTS } from "./nav";

const iconBtn = "flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors hover:bg-subtle hover:text-ink";

/** Hairline top bar: sidebar toggle, a status dot with meta text, and search. */
export function TopBar({ onOpenNav, onNewQuestion }: { onOpenNav: () => void; onNewQuestion: () => void }) {
  const shell = useShell();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 md:gap-3 md:px-4">
      <button className={clsx(iconBtn, "md:hidden")} onClick={onOpenNav} aria-label="Open navigation">
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
      <span className="flex items-center gap-2.5 md:hidden">
        <Logo size={20} />
        <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
      </span>
      <button
        className={clsx(iconBtn, "-ml-2 hidden h-8 w-8 md:flex")}
        onClick={shell.toggleCollapsed}
        aria-label={shell.collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={`${shell.collapsed ? "Expand" : "Collapse"} sidebar  ${SHORTCUTS.toggleSidebar}`}
      >
        {shell.collapsed ? <PanelLeftOpen className="h-4 w-4" strokeWidth={1.6} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={1.6} />}
      </button>

      <div className="hidden min-w-0 flex-1 md:block">
        <StatusMeta />
      </div>
      <div className="flex-1 md:hidden" />

      <button
        onClick={shell.openPalette}
        className="hidden h-9 w-[260px] items-center gap-2.5 border border-line bg-bg px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted md:flex"
        aria-label="Search and jump to"
      >
        <Search className="h-4 w-4" strokeWidth={1.6} aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <span className="flex gap-0.5" aria-hidden>
          <kbd className="kbd">{MOD}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <button className={clsx(iconBtn, "md:hidden")} onClick={shell.openPalette} aria-label="Search and jump to">
        <Search className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
      <button className={clsx(iconBtn, "md:hidden")} onClick={onNewQuestion} aria-label="New question">
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
    </header>
  );
}

/** "● The Shipley School · Demo runtime · synthetic data only" — last-known state, never wakes the GPU. */
export function StatusMeta() {
  const { status } = useStatus();
  const { user } = useAuth();
  if (!status) return <div className="h-5" />;
  const school = schoolName(status.school);
  const { state, is_local } = status.runtime;
  const indexing = !status.index.ready && status.index.total_chunks > 0;
  const tone = state === "unreachable" ? "bg-danger" : !is_local ? "bg-warning" : state === "connected" ? "bg-success" : "bg-accent";
  const parts = [
    school || PRODUCT_NAME,
    !is_local ? "Demo runtime · use synthetic data only" : state === "connected" ? "Connected" : state === "unreachable" ? "Runtime unreachable" : "On-campus runtime",
  ];
  if (indexing) parts.push(`Indexing ${status.index.embedded_chunks}/${status.index.total_chunks}`);

  const body = (
    <span className="flex min-w-0 items-center gap-2.5 text-sm text-muted">
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", tone)} aria-hidden />
      <span className="truncate">
        {parts.join(" · ")}
        <span className="text-faint"> · </span>
        <span className="font-mono text-[12px] text-faint">{status.models.chat}</span>
      </span>
    </span>
  );
  return user?.role === "admin" ? (
    <Link to="/admin" className="inline-flex max-w-full hover:[&_span]:text-ink" title={status.runtime.error || "Runtime settings"}>
      {body}
    </Link>
  ) : (
    <div className="inline-flex max-w-full" title={status.runtime.error || undefined} role="status">
      {body}
    </div>
  );
}
