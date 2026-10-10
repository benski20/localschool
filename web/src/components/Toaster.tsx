import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import clsx from "clsx";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; run: () => void };
  leaving?: boolean;
}

type Push = (t: Omit<Toast, "id" | "leaving">) => void;
const ToastContext = createContext<Push>(() => undefined);

const EXIT_MS = 140;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const push = useCallback<Push>(
    (t) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.filter((x) => !x.leaving).slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.action ? 6000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px] sm:items-stretch"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded border border-line bg-elevated py-3 pl-3.5 pr-2 text-sm shadow-lg",
              t.leaving ? "animate-toast-out" : "animate-toast-in",
            )}
          >
            <span
              className={clsx(
                "mt-px flex h-5 w-4 shrink-0 items-center justify-center",
                t.kind === "success" && "text-success",
                t.kind === "error" && "text-danger",
                t.kind === "info" && "text-faint",
              )}
              aria-hidden
            >
              {t.kind === "error" ? (
                <AlertCircle className="h-4 w-4" strokeWidth={1.75} />
              ) : t.kind === "success" ? (
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Info className="h-4 w-4" strokeWidth={1.75} />
              )}
            </span>
            <p className="min-w-0 flex-1 py-px leading-5 text-ink text-pretty">{t.message}</p>
            {t.action && (
              <button
                className="btn-ghost btn-sm -my-1 text-accent hover:text-accent-hover"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" className="btn-ghost btn-sm btn-icon -my-1 h-6 w-6 text-faint" onClick={() => dismiss(t.id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
