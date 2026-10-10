import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "../lib/api";
import { useToast } from "./Toaster";
import { Field, Spinner } from "./ui";

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 animate-fadein" />
        <Dialog.Content className="fixed left-1/2 top-[16vh] z-50 w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl bg-panel p-6 shadow-pop animate-fadein">
          <Dialog.Title className="text-lg text-ink">Change password</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Use at least 8 characters.</Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Current password" htmlFor="pw-current">
              <input id="pw-current" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field label="New password" htmlFor="pw-new">
              <input id="pw-new" type="password" autoComplete="new-password" minLength={8} className="input" value={next} onChange={(e) => setNext(e.target.value)} required />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close className="btn-secondary" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn-primary" disabled={saving || !current || next.length < 8}>
                {saving && <Spinner />} Change password
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
