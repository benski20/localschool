import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";
import { isDesktop } from "../lib/shell";
import { PRODUCT_NAME } from "../lib/brand";
import { Monogram } from "../components/shell/Monogram";
import { schoolName, useHealth } from "../components/shell/health";

export function Login() {
  const { login } = useAuth();
  const health = useHealth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const demo = health?.demo ?? null;
  const school = schoolName(health?.school);

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
        <div className="animate-fadein w-full max-w-[380px]">
          <div className="rounded-[2px] border border-line bg-panel px-6 pb-8 pt-9 sm:px-9">
            <div className="flex flex-col items-center text-center">
              <Monogram name={school || PRODUCT_NAME} size={40} />
              <h1 className="mt-5 text-xl font-normal text-ink">{school || PRODUCT_NAME}</h1>
              {school && <p className="mt-0.5 text-sm text-faint">{PRODUCT_NAME}</p>}
            </div>

            <form
              className="mt-8 space-y-4"
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
                <label className="field-label" htmlFor="password">
                  Password
                </label>
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
                <p role="alert" className="animate-fadein text-sm text-danger">
                  {error}
                </p>
              )}
              <button className="btn-primary btn-lg mt-2 w-full" disabled={busy !== null}>
                {busy === "form" && <Spinner />} Sign in
              </button>
            </form>
          </div>

          {demo && (
            <p className="mt-6 text-center">
              <button type="button" className="inline-flex items-center gap-2 text-sm text-accent underline-offset-4 hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => signIn(demo.email, demo.password, "demo")}>
                {busy === "demo" && <Spinner className="h-3.5 w-3.5" />} Try the demo
              </button>
            </p>
          )}
        </div>
      </main>

      {!isDesktop && (
        <footer className="pb-8 text-center">
          <a href="/get" className="text-sm text-faint transition-colors hover:text-ink">
            Get the Mac app
          </a>
        </footer>
      )}
    </div>
  );
}
