import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { relativeTime } from "../../lib/api";
import { isWorking, tools, TOOL_PATHS, type DraftSummary, type ToolKey } from "../../lib/tools";
import { statusWord } from "./JobProgress";

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
    <section aria-label="Recent" className="animate-fade-in pt-4">
      <h2 className="label mb-2">Recent</h2>
      <ul className="divide-y divide-line border-t border-line">
        {others.slice(0, 8).map((d) => (
          <li key={d.id} className="group relative flex items-center">
            <Link
              to={`/tools/${tool}/${d.id}`}
                            className={clsx(
                "flex min-w-0 flex-1 items-baseline justify-between gap-4 py-3 pr-9 text-sm transition-colors",
                "text-muted hover:text-ink",
              )}
            >
              <span className="truncate">{d.title || "Untitled"}</span>
              <span className={clsx("shrink-0 text-xs tnum", d.status === "error" ? "text-danger" : "text-faint")}>
                {isWorking(d.status) || d.status === "error" ? statusWord(d) : relativeTime(d.created_at)}
              </span>
            </Link>
            {confirm === d.id ? (
              <button
                type="button"
                autoFocus
                onClick={() => remove(d)}
                onBlur={() => setConfirm(null)}
                className="btn-ghost btn-sm absolute right-0 animate-fade-in bg-bg text-danger hover:text-danger"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(d.id)}
                aria-label={`Delete ${d.title || "draft"}`}
                className="btn-ghost btn-icon btn-sm absolute right-0 text-faint opacity-100 transition-opacity focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
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
