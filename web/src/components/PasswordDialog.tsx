import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "./Toaster";
import { Spinner } from "./ui";

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
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
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const type = show ? "text" : "password";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ls-overlay fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="ls-pop fixed left-1/2 top-[16vh] z-50 w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-[2px] border border-line bg-panel focus:outline-none">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="px-6 pb-6 pt-6">
              <div className="flex items-start justify-between gap-3">
                <Dialog.Title className="text-xl font-normal text-ink">Change password</Dialog.Title>
                <Dialog.Close className="btn-ghost btn-icon -mr-2 -mt-1 h-8 w-8" aria-label="Close" type="button">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Enter your current password and a new one.</Dialog.Description>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="field-label" htmlFor="pw-current">
                    Current password
                  </label>
                  <input id="pw-current" type={type} autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
                </div>
                <div>
                  <label className="field-label" htmlFor="pw-new">
                    New password
                  </label>
                  <div className="relative">
                    <input id="pw-new" type={type} autoComplete="new-password" minLength={8} className="input pr-10" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="pw-hint" required />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-faint transition-colors hover:text-ink"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide passwords" : "Show passwords"}
                      aria-pressed={show}
                    >
                      {show ? <EyeOff className="h-4 w-4" strokeWidth={1.6} /> : <Eye className="h-4 w-4" strokeWidth={1.6} />}
                    </button>
                  </div>
                  <p id="pw-hint" className={next && next.length < 8 ? "mt-1.5 text-xs text-warning" : "mt-1.5 text-xs text-faint"}>
                    At least 8 characters
                  </p>
                </div>
                {error && (
                  <p role="alert" className="animate-fadein text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
              <Dialog.Close className="btn-secondary" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn-primary" disabled={saving || !current || next.length < 8}>
                {saving && <Spinner />} Save
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
