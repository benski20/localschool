import { useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Field, Spinner } from "../components/ui";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px] animate-fadein">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={40} />
          <h1 className="mt-5 text-xl text-ink">Sign in to Local School</h1>
          <p className="mt-1.5 text-sm text-muted">Private AI for your school.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button className="btn-primary h-9 w-full" disabled={busy}>
            {busy && <Spinner />} Sign in
          </button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-faint">
          <Lock className="h-3 w-3" aria-hidden /> Your school's data stays on your school's servers.
        </p>
      </div>
    </div>
  );
}
