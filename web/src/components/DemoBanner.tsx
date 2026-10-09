import { ShieldAlert } from "lucide-react";
import { useStatus } from "../lib/status";

/** Shown whenever models run outside the building: synthetic data only. */
export function DemoBanner() {
  const { status } = useStatus();
  if (!status || status.runtime.is_local) return null;
  return (
    <div role="note" className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning/[0.07] px-4 py-1.5 text-xs text-warning">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">Demo runtime.</span> Models are running on a cloud GPU. Use synthetic data only,
        not real student records.
      </span>
    </div>
  );
}
