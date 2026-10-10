import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";
import { isDesktop } from "../lib/shell";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../lib/brand";
import { Logo } from "../components/Logo";
import { Monogram } from "../components/shell/Monogram";
import { schoolName, useHealth } from "../components/shell/health";

const label = "mb-2 block text-sm text-ink";
const field =
  "h-11 w-full rounded-[2px] border border-line bg-panel px-3.5 text-[15px] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-ink focus:outline-none focus-visible:outline-none";
const eyebrow = "text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-faint";

const POINTS = [
  { title: "Every answer cites its sources", body: "Numbered citations open the exact passage they came from." },
  { title: "Data stays on campus", body: "Documents and rosters stay on your school's own servers." },
  { title: "Knows your class", body: "Accommodations, plans and EL levels, for your sections only." },
];

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    signIn(email, password, "form");
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4 sm:px-6">
        <span className="flex items-center gap-3">
          <Logo size={22} />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
        </span>
        {school && (
          <span className="hidden items-center gap-2.5 border-l border-line pl-4 text-sm text-muted sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {school}
            {demo && <span className="text-faint">· Demo available</span>}
          </span>
        )}
        <span className="flex-1" />
        {!isDesktop && (
          <a href="/get" className="text-sm text-muted transition-colors hover:text-ink">
            Get the Mac app <span aria-hidden>→</span>
          </a>
        )}
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Brand */}
        <section className="order-2 border-t border-line px-4 py-12 sm:px-10 lg:order-1 lg:flex lg:flex-col lg:justify-between lg:border-r lg:border-t-0 lg:px-16 lg:py-16 xl:px-24" aria-label={`About ${PRODUCT_NAME}`}>
          <div className="ls-stagger max-w-[520px]">
            <div className="flex items-center gap-3" style={{ ["--i" as string]: 0 }}>
              <Monogram name={school || PRODUCT_NAME} size={36} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[15px] text-ink">{school || PRODUCT_NAME}</div>
                {school && <div className="mt-0.5 truncate text-xs text-faint">with {PRODUCT_NAME}</div>}
              </div>
            </div>
            <h2 className="mt-10 hidden text-[40px] font-normal leading-[1.15] tracking-[-0.025em] text-ink [text-wrap:balance] lg:block xl:text-[44px]" style={{ ["--i" as string]: 1 }}>
              {PRODUCT_TAGLINE}
            </h2>
            <p className="mt-5 hidden max-w-[440px] text-base text-muted lg:block lg:text-[16px] lg:leading-[26px]" style={{ ["--i" as string]: 2 }}>
              Ask in plain language. Get answers grounded in your school's documents and your own class roster.
            </p>

            <div className="mt-10 lg:mt-14" style={{ ["--i" as string]: 3 }}>
              <div className={eyebrow}>Why teachers trust it</div>
              <ol className="mt-5 space-y-6">
                {POINTS.map((p, i) => (
                  <li key={p.title} className="flex gap-4">
                    <span className="w-6 shrink-0 pt-0.5 font-mono text-[13px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block text-[15px] text-ink">{p.title}</span>
                      <span className="mt-0.5 block text-sm text-muted">{p.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mt-12 hidden items-center gap-1.5 text-xs text-faint lg:flex">
            <Lock className="h-3 w-3" strokeWidth={1.75} aria-hidden /> Private by design
            {health?.version && <span className="ml-auto font-mono">v{health.version}</span>}
          </div>
        </section>

        {/* Sign in */}
        <section className="order-1 flex justify-center bg-panel px-4 py-12 sm:px-10 lg:order-2 lg:items-center lg:py-16">
          <div className="ls-stagger w-full max-w-[400px]">
            <div style={{ ["--i" as string]: 0 }}>
              <div className={eyebrow}>Sign in</div>
              <h1 className="mt-3 text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">Sign in to {PRODUCT_NAME}</h1>
              <p className="mt-2 text-[15px] text-muted">
                {school ? `Use the account ${school} gave you.` : "Use the account your school gave you."}
              </p>
            </div>

            <form onSubmit={submit} className="mt-8 space-y-5" style={{ ["--i" as string]: 1 }}>
              <div>
                <label className={label} htmlFor="email">
                  Email
                </label>
                <input id="email" type="email" autoComplete="username" placeholder="you@school.org" className={field} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className={label} htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    className={`${field} pr-11`}
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
                <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger animate-fadein">
                  {error}
                </p>
              )}
              <button
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-[2px] bg-ink text-[15px] text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={busy !== null}
              >
                {busy === "form" && <Spinner />}
                Sign in
                {busy !== "form" && <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />}
              </button>
            </form>

            {demo && (
              <div className="mt-8" style={{ ["--i" as string]: 2 }}>
                <div className={eyebrow}>Just looking?</div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => signIn(demo.email, demo.password, "demo")}
                  className="group mt-3 flex w-full items-center gap-4 rounded-[2px] border border-line bg-panel px-4 py-3.5 text-left transition-colors hover:border-ink disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-ink">Try the demo</span>
                    <span className="mt-0.5 block text-sm text-muted">Explore as a teacher at a fictional school.</span>
                  </span>
                  {busy === "demo" ? (
                    <Spinner className="text-muted" />
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm text-accent">
                      Start <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
                    </span>
                  )}
                </button>
              </div>
            )}

            <p className="mt-8 flex items-center gap-1.5 text-xs text-faint lg:hidden" style={{ ["--i" as string]: 3 }}>
              <Lock className="h-3 w-3" strokeWidth={1.75} aria-hidden /> Your school's data stays on your school's servers.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
