import { useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, Globe, Lock, PanelTop, Terminal } from "lucide-react";
import { PRODUCT_NAME } from "../lib/brand";
import { Logo } from "../components/Logo";
import { schoolName, useHealth } from "../components/shell/health";
import "../components/shell/shell.css";

const eyebrow = "text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-faint";

/** Public page (/get): the ways to open the app, easiest first. No sign-in needed. */
export function GetApp() {
  const health = useHealth();
  const school = schoolName(health?.school);
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const command = `curl -fsSL ${origin}/install/mac.sh | bash`;
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the command is visible to select by hand */
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 border-b border-line bg-panel">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <Logo size={22} />
            <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
          </a>
          {school && (
            <span className="hidden items-center gap-2.5 border-l border-line pl-4 text-sm text-muted sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              {school}
            </span>
          )}
          <span className="flex-1" />
          <a href="/" className="text-sm text-muted transition-colors hover:text-ink">
            <span aria-hidden>← </span>Back to sign in
          </a>
        </div>
      </header>

      <main className="ls-stagger mx-auto w-full max-w-[760px] px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <div style={{ ["--i" as string]: 0 }}>
          <div className={eyebrow}>{school ? `For ${school}` : "Get the app"}</div>
          <h1 className="mt-3 text-[32px] font-normal leading-[1.15] tracking-[-0.02em] text-ink sm:text-[36px]">Get {PRODUCT_NAME}</h1>
          <p className="mt-3 max-w-[520px] text-[16px] leading-[26px] text-muted">Three ways to open it, easiest first. All of them connect to your school's private server.</p>
        </div>

        <ol className="mt-10 border border-line bg-panel" style={{ ["--i" as string]: 1 }}>
          <Option
            n={1}
            icon={<Globe />}
            title="Use it in your browser"
            tag="Easiest"
            body="Nothing to install. Works in Safari, Chrome and Edge."
            action={
              <a href="/" className="group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[2px] bg-ink px-4 text-sm text-bg transition-opacity hover:opacity-90">
                Open <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
              </a>
            }
          />

          <Option
            n={2}
            icon={<PanelTop />}
            title="Keep it in your Dock"
            body={
              safari ? (
                <>
                  In Safari's menu bar choose <Path>File → Add to Dock</Path>. It opens in its own window, like an app.
                </>
              ) : (
                <>
                  In Safari choose <Path>File → Add to Dock</Path>. In Chrome: <Path>⋮ → Cast, save, and share → Install page as app</Path>.
                </>
              )
            }
          />

          <Option
            n={3}
            icon={<Terminal />}
            title={`${PRODUCT_NAME} for Mac`}
            body={
              <>
                Adds <kbd className="kbd">⌥</kbd> <kbd className="kbd">Space</kbd> to ask from anywhere. Open Terminal, paste this line and press Return.
              </>
            }
          >
            <div className="mt-4 flex items-stretch border border-line bg-bg">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3.5 py-3 font-mono text-[13px] leading-5 text-ink" title={command}>
                <span className="select-none text-faint">$ </span>
                {command}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 border-l border-line bg-panel px-3.5 text-sm text-ink transition-colors hover:bg-subtle"
                aria-live="polite"
              >
                {copied ? <Check className="h-4 w-4 text-success" strokeWidth={1.75} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.6} aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-sm text-faint">
              Saw "Not Opened"? That happens with downloads from the browser. Use the line above instead, it installs without that warning.
            </p>
          </Option>
        </ol>

        <p className="mt-8 flex items-center gap-1.5 text-xs text-faint" style={{ ["--i" as string]: 2 }}>
          <Lock className="h-3 w-3" strokeWidth={1.75} aria-hidden /> Your school's data stays on your school's servers.
        </p>
      </main>
    </div>
  );
}

function Path({ children }: { children: ReactNode }) {
  return <span className="text-ink">{children}</span>;
}

function Option({
  n,
  icon,
  title,
  body,
  tag,
  action,
  children,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  body: ReactNode;
  tag?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="border-line px-5 py-6 transition-colors [&+&]:border-t sm:px-7">
      <div className="flex items-start gap-4 sm:gap-5">
        <span className="w-6 shrink-0 pt-0.5 font-mono text-[13px] text-accent">{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-faint [&>svg]:h-4 [&>svg]:w-4 [&>svg]:[stroke-width:1.6]" aria-hidden>
              {icon}
            </span>
            <h2 className="text-[16px] font-normal text-ink">{title}</h2>
            {tag && <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-success">{tag}</span>}
          </div>
          <p className="mt-1.5 text-sm leading-[22px] text-muted">{body}</p>
          {action && <div className="mt-4 sm:hidden [&>*]:w-full">{action}</div>}
          {children}
        </div>
        {action && <div className="hidden sm:block">{action}</div>}
      </div>
    </li>
  );
}
