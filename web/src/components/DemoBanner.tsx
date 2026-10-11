import { useHealth } from "./shell/health";

/** One quiet line in the sidebar footer: on the synthetic demo server, or a teacher's own Mac. */
export function DemoNotice() {
  const health = useHealth();
  if (health?.local) {
    return (
      <p role="note" className="text-[12px] leading-[17px] text-faint">
        Your data is kept on this Mac
      </p>
    );
  }
  if (!health?.demo) return null;
  return (
    <p role="note" className="text-[12px] leading-[17px] text-faint">
      Demo · use made-up data only
    </p>
  );
}
