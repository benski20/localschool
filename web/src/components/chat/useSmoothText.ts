import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveal streamed text at an even pace instead of in network-sized bursts.
 * The reveal speeds up as the backlog grows, so it never falls far behind the model,
 * and catches up immediately once the stream ends.
 */
export function useSmoothText(target: string, streaming: boolean): string {
  const [shown, setShown] = useState(streaming ? "" : target);
  const len = useRef(streaming ? 0 : target.length);
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    if (!streaming || reduced()) {
      len.current = target.length;
      setShown(target);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const t = latest.current;
      const dt = Math.min(64, now - last);
      last = now;
      const backlog = t.length - len.current;
      if (backlog > 0) {
        // ~60 chars/s baseline, faster when behind.
        const step = Math.max(1, Math.round((dt / 1000) * (60 + backlog * 6)));
        len.current = Math.min(t.length, len.current + step);
        // Don't stop mid-word if the word is already here.
        const space = t.indexOf(" ", len.current);
        if (space > 0 && space - len.current < 3) len.current = space;
        setShown(t.slice(0, len.current));
      } else if (len.current > t.length) {
        len.current = t.length;
        setShown(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the stream completes the server may send cleaned-up content; show it as-is.
  useEffect(() => {
    if (!streaming) {
      len.current = target.length;
      setShown(target);
    }
  }, [target, streaming]);

  return shown;
}
