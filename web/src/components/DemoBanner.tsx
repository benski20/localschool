import { useHealth } from "./shell/health";

/** One quiet line in the sidebar footer, only on the synthetic demo server. */
export function DemoNotice() {
  const health = useHealth();
  if (!health?.demo) return null;
  return (
    <p role="note" className="text-[12px] leading-[17px] text-faint">
      Demo · use made-up data only
    </p>
  );
}
