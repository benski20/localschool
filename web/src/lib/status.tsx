import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Status } from "./types";

interface StatusState {
  status: Status | null;
  refresh: () => void;
}

const StatusContext = createContext<StatusState>({ status: null, refresh: () => undefined });

/**
 * App-wide runtime/index status. The server answers from last-known state and never
 * pings the GPU, so polling here can't wake (or bill) a scale-to-zero runtime.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);

  const refresh = useCallback(() => {
    api.get<Status>("/api/status").then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const syncing = status && (!status.index.ready || status.index.syncing);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, syncing ? 3000 : 15000);
    return () => window.clearInterval(id);
  }, [refresh, status?.index.ready, status?.index.syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  return <StatusContext.Provider value={{ status, refresh }}>{children}</StatusContext.Provider>;
}

export const useStatus = () => useContext(StatusContext);
