import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User } from "../lib/types";
import { Spinner } from "../components/ui";
import { PRODUCT_NAME } from "../lib/brand";
import { Monogram } from "../components/shell/Monogram";
import { schoolName, useHealth } from "../components/shell/health";

interface StartReply {
  ok: boolean;
  message: string;
  /** The fictional demo has no email server: the code comes back to show on screen. */
  demo_code?: string;
  demo_notice?: string;
}

const COPY = {
  signup: {
    title: "Create your account",
    intro: "Use your school email. We'll send you a code to confirm it's you.",
    send: "Email me a code",
    finish: "Create account",
    password: "Choose a password",
  },
  reset: {
    title: "Reset your password",
    intro: "Enter the email you sign in with. We'll send you a code to set a new password.",
    send: "Email me a code",
    finish: "Set password",
    password: "New password",
  },
} as const;

/** Join with a school email (/signup) and Forgot password (/reset): the same card as the
 *  sign-in page, in two steps — email, then the emailed code and a password. */
export function Signup({ mode }: { mode: "signup" | "reset" }) {
  const { signedIn } = useAuth();
  const health = useHealth();
  const location = useLocation();
  const copy = COPY[mode];
  const school = schoolName(health?.school);
  const domains = health?.signup_domains ?? [];
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(((location.state as { email?: string } | null)?.email ?? "").trim());
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<StartReply | null>(null);

  const available = health === null || (mode === "signup" ? health.signup : health.reset);

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const r = await api.post<StartReply>(`/api/auth/${mode}/start`, mode === "signup" ? { name, email } : { email });
      setSent(r);
      setCode(r.demo_code ?? "");
      setStep(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const body = mode === "signup" ? { email, code, password, name } : { email, code, password };
      const r = await api.post<{ user: User }>(`/api/auth/${mode}/finish`, body);
      signedIn(r.user); // the app opens on Ask
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="animate-fade-in w-full max-w-[380px]">
          <div className="rounded-2xl bg-panel shadow-md px-6 pb-8 pt-9 sm:px-9">
            <div className="flex flex-col items-center text-center">
              <Monogram name={school || PRODUCT_NAME} size={40} />
              <h1 className="mt-5 text-xl font-normal text-ink">{copy.title}</h1>
              <p className="mt-1.5 text-sm text-muted">
                {step === 1
                  ? copy.intro
                  : sent?.demo_code || sent?.demo_notice
                    ? `For ${email}`
                    : `${sent?.message ?? ""} Check ${email}; the code works for 15 minutes.`}
              </p>
            </div>

            {!available ? (
              <p className="mt-8 text-center text-sm text-muted">
                {mode === "signup" ? "Ask your administrator to add you." : "Ask your administrator to reset your password."}
              </p>
            ) : step === 1 ? (
              <form
                className="mt-8 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendCode();
                }}
              >
                {mode === "signup" && (
                  <div>
                    <label className="field-label" htmlFor="name">
                      Your name
                    </label>
                    <input id="name" autoComplete="name" className="input h-11" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                  </div>
                )}
                <div>
                  <label className="field-label" htmlFor="email">
                    {mode === "signup" ? "School email" : "Email"}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="input h-11"
                    placeholder={mode === "signup" && domains.length ? `you@${domains[0]}` : undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus={mode === "reset"}
                  />
                </div>
                {error && (
                  <p role="alert" className="animate-fade-in text-sm text-danger">
                    {error}
                  </p>
                )}
                <button className="btn-primary btn-lg mt-2 w-full" disabled={busy}>
                  {busy && <Spinner />} {copy.send}
                </button>
              </form>
            ) : (
              <form
                className="mt-8 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  finish();
                }}
              >
                {sent?.demo_code && (
                  <p className="animate-fade-in rounded-lg bg-accent/[0.07] px-3.5 py-2.5 text-sm text-ink">
                    Demo: your code is <span className="font-mono tracking-wider">{sent.demo_code}</span>
                  </p>
                )}
                {sent?.demo_notice && <p className="animate-fade-in rounded-lg bg-ink/[0.04] px-3.5 py-2.5 text-sm text-ink">{sent.demo_notice}</p>}
                <div>
                  <label className="field-label" htmlFor="code">
                    Code from the email
                  </label>
                  <input
                    id="code"
                    className="input h-11 text-center font-mono text-lg tracking-[0.4em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    maxLength={7}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="password">
                    {copy.password}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      className="input h-11 pr-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-faint transition-colors hover:text-ink"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide password" : "Show password"}
                      aria-pressed={show}
                    >
                      {show ? <EyeOff className="h-4 w-4" strokeWidth={1.6} /> : <Eye className="h-4 w-4" strokeWidth={1.6} />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-faint">At least 8 characters.</p>
                </div>
                {error && (
                  <p role="alert" className="animate-fade-in text-sm text-danger">
                    {error}
                  </p>
                )}
                <button className="btn-primary btn-lg mt-2 w-full" disabled={busy}>
                  {busy && <Spinner />} {copy.finish}
                </button>
                <div className="flex justify-between gap-4 pt-1 text-sm">
                  <button
                    type="button"
                    className="text-faint transition-colors hover:text-ink"
                    onClick={() => {
                      setStep(1);
                      setError("");
                      setSent(null);
                      setCode("");
                    }}
                  >
                    Use a different email
                  </button>
                  <button type="button" className="text-faint transition-colors hover:text-ink disabled:opacity-50" disabled={busy} onClick={sendCode}>
                    Send a new code
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            {mode === "signup" ? "Already have an account? " : "Remembered it? "}
            <Link to="/" className="text-accent underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <footer className="flex justify-center gap-6 pb-8 text-center">
        <a href="/privacy" className="text-sm text-faint transition-colors hover:text-ink">
          Privacy
        </a>
      </footer>
    </div>
  );
}
