import { useEffect, useState } from "react";
import { GraduationCap, Lock } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Field, Spinner } from "../components/ui";
import { isDesktop } from "../lib/shell";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ email: string; password: string } | null>(null);
  const [school, setSchool] = useState("");

  useEffect(() => {
    api
      .get<{ demo?: { email: string; password: string }; school?: string }>("/api/health")
      .then((h) => {
        setDemo(h.demo ?? null);
        if (h.school && h.school !== "Local School") setSchool(h.school);
      })
      .catch(() => undefined);
  }, []);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError("");
    try {
      await login(e, p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          <h1 className="mt-5 text-xl text-ink">Sign in to {school || "Local School"}</h1>
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
        {demo && (
          <div className="card mt-4 flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">Just looking?</div>
              <div className="text-xs text-muted">Try it as a demo teacher at a fictional school.</div>
            </div>
            <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={() => signIn(demo.email, demo.password)}>
              Try the demo
            </button>
          </div>
        )}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-faint">
          <Lock className="h-3 w-3" aria-hidden /> Your school's data stays on your school's servers.
        </p>
        {!isDesktop && (
          <p className="mt-2 text-center text-xs">
            <a href="/get" className="text-muted hover:text-ink hover:underline">
              Get the Mac app
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
