import { useCallback, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import "./common.css";

/** One choice from GET /api/models. */
export interface ModelOption {
  model: string;
  label: string;
  description: string;
  installed?: boolean;
}

export interface ModelChoices {
  default: string;
  options: ModelOption[];
}

let cached: Promise<ModelChoices | null> | null = null;

/** GET /api/models once per page load. Resolves null when the endpoint is missing or fails. */
export function fetchModels(): Promise<ModelChoices | null> {
  if (!cached)
    cached = fetch("/api/models", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = (await r.json()) as Partial<ModelChoices>;
        const options = (d.options ?? []).filter((o) => o && o.model && o.installed !== false);
        return { default: d.default ?? options[0]?.model ?? "", options };
      })
      .catch(() => null);
  return cached;
}

const keyFor = (uid?: number | string) => `ls-model${uid !== undefined ? `:${uid}` : ""}`;

/**
 * The teacher's model choice, remembered in localStorage per user.
 * `model` is undefined until /api/models answers (or when it doesn't exist), so callers can
 * simply omit it from requests and the server uses its default.
 */
export function useModelChoice(userId?: number | string) {
  const [choices, setChoices] = useState<ModelChoices | null>(null);
  const [model, setModelState] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchModels().then((c) => {
      if (!live || !c) return;
      setChoices(c);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(keyFor(userId));
      } catch {
        /* storage blocked */
      }
      const ok = (m: string | null) => !!m && c.options.some((o) => o.model === m);
      setModelState(ok(saved) ? saved! : ok(c.default) ? c.default : c.options[0]?.model);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const setModel = useCallback(
    (m: string) => {
      setModelState(m);
      try {
        localStorage.setItem(keyFor(userId), m);
      } catch {
        /* per-visit only */
      }
    },
    [userId],
  );

  /** Friendly label for a model name; "" if it isn't one of the choices. */
  const labelFor = useCallback((m?: string) => choices?.options.find((o) => o.model === m)?.label ?? "", [choices]);

  return { options: choices?.options ?? [], defaultModel: choices?.default ?? "", model, setModel, labelFor };
}

/**
 * Small "Fast ▾" button with a popover of choices. Renders nothing when there's
 * only one option (or none, e.g. while /api/models is unavailable).
 */
export function ModelPicker({
  options,
  value,
  onChange,
  placement = "up",
  disabled,
}: {
  options: ModelOption[];
  value: string | undefined;
  onChange: (model: string) => void;
  /** Open above (composer at the bottom) or below the button. */
  placement?: "up" | "down";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(list.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus());
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (options.length < 2) return null;
  const current = options.find((o) => o.model === value) ?? options[0];

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Answer style: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1 rounded-[2px] px-2 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink aria-expanded:bg-subtle aria-expanded:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        {current.label}
        <ChevronDown className={clsx("h-3.5 w-3.5 text-faint transition-transform duration-150", open && "rotate-180")} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label="Answer style"
          className={clsx(
            "absolute z-50 w-[272px] max-w-[calc(100vw-48px)] rounded-[2px] border border-line bg-panel p-1 shadow-lg",
            placement === "up" ? "ls-popover-up bottom-full mb-2" : "ls-popover-down top-full mt-2",
            "left-0",
          )}
        >
          {options.map((o) => {
            const on = o.model === current.model;
            return (
              <button
                key={o.model}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onChange(o.model);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className="flex w-full items-start gap-3 rounded-[2px] px-3 py-2.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-ink">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-[12.5px] leading-[18px] text-faint">{o.description}</span>}
                </span>
                <Check className={clsx("mt-[3px] h-4 w-4 shrink-0 text-ink", on ? "opacity-100" : "opacity-0")} strokeWidth={2} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
