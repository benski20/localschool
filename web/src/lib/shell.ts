/** True inside the Teacher's Desk Mac app (its webview identifies itself in the user agent). */
export const isDesktop = typeof navigator !== "undefined" && navigator.userAgent.includes("LocalSchoolDesktop");
