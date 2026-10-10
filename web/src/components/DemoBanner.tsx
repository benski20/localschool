import { useStatus } from "../lib/status";

/**
 * Shown whenever models run outside the building: synthetic data only.
 * On wide screens the top bar's status meta carries this; phones get a slim strip.
 */
export function DemoBanner() {
  const { status } = useStatus();
  if (!status || status.runtime.is_local) return null;
  return (
    <div role="note" className="flex h-8 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-4 text-xs text-muted md:hidden">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-warning">Demo</span>
      <span className="truncate">Use synthetic data only, not real student records.</span>
    </div>
  );
}
