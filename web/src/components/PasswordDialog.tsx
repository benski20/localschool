import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "./Toaster";
import { Field, Spinner } from "./ui";

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setShow(false);
    }
  }, [open]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.put("/api/auth/password", { current, new: next });
      toast({ kind: "success", message: "Password changed." });
      setCurrent("");
      setNext("");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Length-only guidance (the server's only rule is 8+ characters).
  const strength = next.length === 0 ? 0 : next.length < 8 ? 1 : next.length < 12 ? 2 : 3;
  const strengthLabel = ["At least 8 characters", "Too short", "Good", "Strong"][strength];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ls-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="ls-pop fixed left-1/2 top-[14vh] z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[2px] border border-line-strong bg-panel focus:outline-none">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="p-6 pb-5">
              <div className="flex items-start gap-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> Account
                  </div>
                  <Dialog.Title className="mt-2 text-[22px] font-normal leading-7 tracking-[-0.015em] text-ink">Change password</Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-sm text-muted">You'll stay signed in on this device.</Dialog.Description>
                </div>
                <Dialog.Close className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center text-faint transition-colors hover:bg-subtle hover:text-ink" aria-label="Close" type="button">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>

              <div className="mt-6 space-y-4">
                <Field label="Current password" htmlFor="pw-current">
                  <input
                    id="pw-current"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    className="input"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    required
                    autoFocus
                  />
                </Field>
                <div>
                  <label className="label" htmlFor="pw-new">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="pw-new"
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      className="input pr-10"
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                      aria-describedby="pw-strength"
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-faint transition-colors hover:bg-subtle hover:text-ink"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide passwords" : "Show passwords"}
                      aria-pressed={show}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3" id="pw-strength">
                    <div className="flex flex-1 gap-1" aria-hidden>
                      {[1, 2, 3].map((n) => (
                        <span
                          key={n}
                          className={clsx(
                            "h-0.5 flex-1 transition-colors duration-200",
                            strength >= n ? (strength === 1 ? "bg-warning" : "bg-success") : "bg-subtle",
                          )}
                        />
                      ))}
                    </div>
                    <span className={clsx("w-40 text-right text-[11px] font-medium uppercase tracking-[0.06em]", strength === 1 ? "text-warning" : strength > 1 ? "text-success" : "text-faint")}>
                      {strengthLabel}
                    </span>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger animate-fadein">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
              <Dialog.Close className="h-9 rounded-[2px] border border-line bg-panel px-4 text-sm text-ink transition-colors hover:border-line-strong hover:bg-subtle" type="button">
                Cancel
              </Dialog.Close>
              <button className="inline-flex h-9 min-w-[150px] items-center justify-center gap-2 rounded-[2px] bg-ink px-4 text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-40" disabled={saving || !current || next.length < 8}>
                {saving && <Spinner />} Change password
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
