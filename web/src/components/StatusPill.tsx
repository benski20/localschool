import { Link } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import { Dot, Progress } from "./ui";

/** "● CONNECTED  qwen3:8b" — from last-known state; never wakes the GPU. Flat, hairline. */
export function StatusPill() {
  const { status } = useStatus();
  const { user } = useAuth();
  if (!status) return <div className="skeleton h-[38px]" />;

  const { state } = status.runtime;
  const tone = state === "connected" ? "success" : state === "unreachable" ? "danger" : "neutral";
  const label = state === "connected" ? "Connected" : state === "unreachable" ? "Unreachable" : "Ready";
  const indexing = !status.index.ready && status.index.total_chunks > 0;
  const pct = status.index.total_chunks ? Math.round((status.index.embedded_chunks / status.index.total_chunks) * 100) : 0;
  const isAdmin = user?.role === "admin";

  const body = (
    <div className={clsx("rounded bg-ink/[0.04] px-3 py-2.5 transition-colors duration-fast", isAdmin && "hover:bg-ink/[0.06]")}>
      <div className="flex items-center gap-2">
        <Dot tone={tone} />
        <span className={clsx("status-text", `status-${tone}`)}>{label}</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-faint">{status.models.chat}</span>
      </div>
      {indexing && (
        <div className="mt-2.5 space-y-1.5">
          <div className="flex justify-between text-[11px] tabular-nums text-faint">
            <span>Indexing passages</span>
            <span className="font-mono">
              {status.index.embedded_chunks}/{status.index.total_chunks}
            </span>
          </div>
          <Progress value={pct} />
        </div>
      )}
      {state === "idle" && !status.runtime.is_local && !indexing && (
        <div className="mt-1 truncate pl-3.5 text-[11px] text-faint">GPU sleeps when idle</div>
      )}
    </div>
  );
  return isAdmin ? (
    <Link to="/admin" className="block rounded" title={status.runtime.error || "Runtime settings"}>
      {body}
    </Link>
  ) : (
    <div title={status.runtime.error}>{body}</div>
  );
}
