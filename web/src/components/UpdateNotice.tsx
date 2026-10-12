import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PRODUCT_NAME } from "../lib/brand";

const CHECK_EVERY_MS = 5 * 60 * 1000;

/** The build this page is running: the hashed main script, e.g. /assets/index-AbC123.js. */
function currentBuild(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

/** The build the server hands out now (index.html is never cached). */
async function latestBuild(): Promise<string | null> {
  try {
    const html = await (await fetch("/", { cache: "no-store", credentials: "same-origin" })).text();
    return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** A quiet notice when a new version has been deployed while this page was open. */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return; // the dev server
    let stopped = false;
    const check = async () => {
      const latest = await latestBuild();
      if (!stopped && latest && latest !== mine) setReady(true);
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="animate-fade-in fixed inset-x-0 bottom-5 z-[100] flex justify-center px-4 print:hidden">
      <div className="flex items-center gap-4 border border-ink/[0.07] bg-panel py-2.5 pl-4 pr-2.5 text-sm text-ink shadow-lg">
        <span>A new version of {PRODUCT_NAME} is ready.</span>
        <button type="button" className="btn-primary btn-sm" onClick={() => location.reload()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
        </button>
      </div>
    </div>
  );
}
