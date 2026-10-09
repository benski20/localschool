import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import clsx from "clsx";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; run: () => void };
}

type Push = (t: Omit<Toast, "id">) => void;
const ToastContext = createContext<Push>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const push = useCallback<Push>(
    (t) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.action ? 6000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="pointer-events-auto flex animate-fadein items-start gap-2.5 rounded-lg bg-panel px-3.5 py-3 text-sm shadow-pop">
            {t.kind === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <CheckCircle2 className={clsx("mt-0.5 h-4 w-4 shrink-0", t.kind === "success" ? "text-success" : "text-faint")} aria-hidden />
            )}
            <p className="flex-1 text-ink">{t.message}</p>
            {t.action && (
              <button
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" className="text-faint hover:text-ink" onClick={() => dismiss(t.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
