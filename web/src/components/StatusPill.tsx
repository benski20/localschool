import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import { Dot } from "./ui";

/** "● Connected · qwen3:8b" — from last-known state; never wakes the GPU. */
export function StatusPill() {
  const { status } = useStatus();
  const { user } = useAuth();
  if (!status) return <div className="h-[38px]" />;

  const { state } = status.runtime;
  const tone = state === "connected" ? "success" : state === "unreachable" ? "danger" : "neutral";
  const label = state === "connected" ? "Connected" : state === "unreachable" ? "Unreachable" : "Ready";
  const indexing = !status.index.ready && status.index.total_chunks > 0;

  const body = (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2 text-xs">
        <Dot tone={tone} />
        <span className="font-medium text-ink">{label}</span>
        <span className="text-faint">·</span>
        <span className="truncate font-mono text-[11px] text-muted">{status.models.chat}</span>
      </div>
      {indexing && (
        <div className="mt-0.5 truncate pl-3.5 text-[11px] text-faint">
          Indexing {status.index.embedded_chunks}/{status.index.total_chunks} passages
        </div>
      )}
      {state === "idle" && !status.runtime.is_local && !indexing && (
        <div className="mt-0.5 truncate pl-3.5 text-[11px] text-faint">GPU sleeps when idle</div>
      )}
    </div>
  );
  return user?.role === "admin" ? (
    <Link to="/admin" className="block" title={status.runtime.error || "Runtime settings"}>
      {body}
    </Link>
  ) : (
    <div title={status.runtime.error}>{body}</div>
  );
}
