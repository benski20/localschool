/** True inside the Local School Mac app (its webview identifies itself in the user agent). */
export const isDesktop = typeof navigator !== "undefined" && navigator.userAgent.includes("LocalSchoolDesktop");
