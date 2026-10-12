import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { relativeTime } from "../../lib/api";
import { isWorking, statusWord, tools, TOOL_PATHS, type DraftSummary, type ToolKey } from "../../lib/tools";

/**
 * The quiet "Recent" list under a tool. Hidden entirely when there is nothing yet.
 * Bump `refreshKey` after creating a draft to reload it.
 */
export function DraftList({ tool, activeId, refreshKey }: { tool: ToolKey; activeId?: number | null; refreshKey?: unknown }) {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    tools
      .list(tool)
      .then((d) => alive && setDrafts(d))
      .catch(() => alive && setDrafts([]));
    return () => {
      alive = false;
    };
  }, [tool, refreshKey, activeId]);

  // While something is still being drafted, refresh quietly so its row settles to a time.
  const pending = drafts?.some((d) => isWorking(d.status));
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => tools.list(tool).then(setDrafts).catch(() => undefined), 3000);
    return () => window.clearInterval(t);
  }, [pending, tool]);

  const others = drafts?.filter((d) => d.id !== activeId) ?? [];
  if (others.length === 0) return null;

  const remove = (d: DraftSummary) => {
    setDrafts((ds) => ds?.filter((x) => x.id !== d.id) ?? null);
    tools.remove(d.id).catch(() => undefined);
    if (d.id === activeId) navigate(TOOL_PATHS[tool], { replace: true });
  };

  return (
    <section aria-label="Recent" className="animate-fade-in pt-2">
      <h2 className="mb-2 text-sm font-medium text-muted">Recent</h2>
      <ul className="-mx-3 space-y-0.5">
        {others.slice(0, 8).map((d) => (
          <li key={d.id} className="group relative flex items-center rounded-lg transition-colors duration-fast hover:bg-ink/[0.03]">
            <Link
              to={`/tools/${tool}/${d.id}`}
              className={clsx(
                "flex min-w-0 flex-1 items-baseline justify-between gap-4 rounded-lg py-2.5 pl-3 pr-11 text-sm transition-colors",
                "text-ink/80 hover:text-ink",
              )}
            >
              <span className="truncate">{d.title || "Untitled"}</span>
              <span className={clsx("shrink-0 text-xs tnum", d.status === "error" ? "text-danger" : "text-faint")}>
                {d.status === "ready" ? relativeTime(d.created_at) : d.status === "awaiting_audio" ? "Not uploaded" : statusWord(d)}
              </span>
            </Link>
            {confirm === d.id ? (
              <button
                type="button"
                autoFocus
                onClick={() => remove(d)}
                onBlur={() => setConfirm(null)}
                className="btn-ghost btn-sm absolute right-1.5 animate-fade-in bg-bg text-danger hover:text-danger"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(d.id)}
                aria-label={`Delete ${d.title || "draft"}`}
                className="btn-ghost btn-icon btn-sm absolute right-1.5 text-faint opacity-100 transition-opacity focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
