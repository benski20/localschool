import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";
import { isDesktop } from "../lib/shell";
import { PRODUCT_NAME } from "../lib/brand";
import { Monogram } from "../components/shell/Monogram";
import { schoolName, useHealth } from "../components/shell/health";
import { api } from "../lib/api";

const SSO_LABEL: Record<string, string> = { google: "Google", microsoft: "Microsoft" };

export function Login() {
  const { login } = useAuth();
  const health = useHealth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const demo = health?.demo ?? null;
  const school = schoolName(health?.school);
  const sso = health?.sso ?? [];
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");

  async function continueWith(provider: string) {
    if (!isDesktop) {
      window.location.href = `/api/auth/sso/${provider}/start?mode=web`;
      return;
    }
    // Mac app: Google and Microsoft sign in in the teacher's browser, then hand back here.
    setError("");
    try {
      const { url } = await api.get<{ url: string }>(`/api/auth/sso/${provider}/start?mode=app&json=1`);
      window.location.href = url; // not this server: the app opens it in the default browser
      setHint(`Finish signing in with ${SSO_LABEL[provider]} in your browser.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function signIn(e: string, p: string, via: "form" | "demo") {
    setBusy(via);
    setError("");
    try {
      await login(e, p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="animate-fade-in w-full max-w-[380px]">
          <div className="rounded-2xl bg-panel shadow-md px-6 pb-8 pt-9 sm:px-9">
            <div className="flex flex-col items-center text-center">
              <Monogram name={school || PRODUCT_NAME} size={40} />
              <h1 className="mt-5 text-xl font-normal text-ink">{school || PRODUCT_NAME}</h1>
              {school && <p className="mt-0.5 text-sm text-faint">{PRODUCT_NAME}</p>}
            </div>

            {sso.length > 0 && (
              <div className="mt-8 space-y-2.5">
                {sso.map((p) => (
                  <button key={p} type="button" className="btn-secondary btn-lg w-full" onClick={() => continueWith(p)} disabled={busy !== null}>
                    <ProviderMark provider={p} /> Continue with {SSO_LABEL[p] ?? p}
                  </button>
                ))}
                <div className="flex items-center gap-3 pt-3 text-xs text-faint" aria-hidden>
                  <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
                </div>
              </div>
            )}
            {hint && !error && <p className="animate-fade-in mt-4 text-center text-sm text-muted">{hint}</p>}
            {ssoError && !error && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {ssoError}
              </p>
            )}

            <form
              className={sso.length ? "mt-3 space-y-4" : "mt-8 space-y-4"}
              onSubmit={(e) => {
                e.preventDefault();
                signIn(email, password, "form");
              }}
            >
              <div>
                <label className="field-label" htmlFor="email">
                  Email
                </label>
                <input id="email" type="email" autoComplete="username" className="input h-11" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label className="field-label" htmlFor="password">
                    Password
                  </label>
                  {health?.reset && (
                    <Link to="/reset" state={{ email }} className="text-sm text-faint transition-colors hover:text-ink">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
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
              </div>
              {error && (
                <p role="alert" className="animate-fade-in text-sm text-danger">
                  {error}
                </p>
              )}
              <button className="btn-primary btn-lg mt-2 w-full" disabled={busy !== null}>
                {busy === "form" && <Spinner />} Sign in
              </button>
            </form>
          </div>

          {health?.signup && (
            <p className="mt-6 text-center text-sm text-muted">
              New here?{" "}
              <Link to="/signup" className="text-accent underline-offset-4 hover:underline">
                Create an account
              </Link>
            </p>
          )}

          {demo && (
            <p className={health?.signup ? "mt-3 text-center" : "mt-6 text-center"}>
              <button type="button" className="inline-flex items-center gap-2 text-sm text-accent underline-offset-4 hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => signIn(demo.email, demo.password, "demo")}>
                {busy === "demo" && <Spinner className="h-3.5 w-3.5" />} Try the demo
              </button>
            </p>
          )}
        </div>
      </main>

      <footer className="flex justify-center gap-6 pb-8 text-center">
        {!isDesktop && (
          <a href="/get" className="text-sm text-faint transition-colors hover:text-ink">
            Get the Mac app
          </a>
        )}
        <a href="/privacy" className="text-sm text-faint transition-colors hover:text-ink">
          Privacy
        </a>
      </footer>
    </div>
  );
}

function ProviderMark({ provider }: { provider: string }) {
  if (provider === "microsoft")
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="1" y="1" width="6.5" height="6.5" fill="#F25022" />
        <rect x="8.5" y="1" width="6.5" height="6.5" fill="#7FBA00" />
        <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00A4EF" />
        <rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#FFB900" />
      </svg>
    );
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
