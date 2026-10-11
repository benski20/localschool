/** True inside the Teacher's Desk Mac app (its webview identifies itself in the user agent). */
export const isDesktop = typeof navigator !== "undefined" && navigator.userAgent.includes("LocalSchoolDesktop");

/** The Mac app's version ("" in a browser, or in apps older than 0.5.1, whose user agent didn't carry it). */
export const desktopVersion = (() => {
  const m = typeof navigator !== "undefined" ? /LocalSchoolDesktop\/([\d.]+)/.exec(navigator.userAgent) : null;
  return m && m[1] !== "0.1.0" ? m[1] : "";
})();

/** "0.5.10" > "0.5.9": compared part by part, like the Mac app does. */
export function isNewer(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
