import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { PRODUCT_NAME } from "../../lib/brand";

export interface Health {
  ok?: boolean;
  version?: string;
  school?: string;
  demo?: { email: string; password: string };
  mac_release_page?: string;
  /** A teacher's own server on their Mac: their data never leaves it. */
  local?: boolean;
  /** Sign-in providers this school turned on: "google", "microsoft". */
  sso?: string[];
}

let cached: Promise<Health> | null = null;

/** Public /api/health, fetched once per page load and shared. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    if (!cached) cached = api.get<Health>("/api/health").catch(() => ({}) as Health);
    let live = true;
    cached.then((h) => live && setHealth(h));
    return () => {
      live = false;
    };
  }, []);
  return health;
}

/** The school's display name, or "" when the server still uses the default. */
export function schoolName(raw: string | undefined | null): string {
  const s = (raw ?? "").trim();
  return s && s !== PRODUCT_NAME && s !== "Local School" ? s : "";
}
