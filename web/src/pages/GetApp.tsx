import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { PRODUCT_NAME } from "../lib/brand";
import { Monogram } from "../components/shell/Monogram";
import { schoolName, useHealth } from "../components/shell/health";

/** Public page (/get): open it in the browser, or install the Mac app. No sign-in needed. */
export function GetApp() {
  const health = useHealth();
  const school = schoolName(health?.school);
  const [copied, setCopied] = useState(false);
  const command = `curl -fsSL ${window.location.origin}/install/mac.sh | bash`;

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
      <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-12 sm:px-8 sm:pt-20">
        <a href="/" className="inline-flex items-center gap-3">
          <Monogram name={school || PRODUCT_NAME} size={28} />
          <span className="text-sm text-muted">{school || PRODUCT_NAME}</span>
        </a>
        <h1 className="mt-10 text-2xl font-normal text-ink">Get {PRODUCT_NAME}</h1>

        <div className="mt-10 divide-y divide-line border-y border-line">
          <Option
            title="Use it in your browser"
            body="Nothing to install."
            action={
              <a href="/" className="btn-primary shrink-0">
                Open
              </a>
            }
          />

          <Option title="Mac app" body="Open Terminal, paste this line and press Return.">
            <div className="mt-4 flex w-full items-stretch rounded-[2px] border border-line bg-panel">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3.5 py-3 font-mono text-[13px] leading-5 text-ink [scrollbar-width:thin]" title={command}>
                {command}
              </code>
              <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 border-l border-line px-3.5 text-sm text-ink transition-colors hover:bg-subtle" aria-live="polite">
                {copied ? <Check className="h-4 w-4 text-success" strokeWidth={1.75} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.6} aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-sm text-faint">Saw “Not Opened”? That happens with downloads from the browser. The line above installs without that warning.</p>
          </Option>
        </div>

        <section id="keep" className="mt-12 scroll-mt-8">
          <h2 className="text-lg font-normal text-ink">Keep your data on your Mac</h2>
          <p className="mt-2 text-base text-muted">
            With the Mac app, your documents, students and chats can stay on your own Mac instead of the school's server. Answers
            still come from the school's AI.
          </p>
          <ol className="mt-4 space-y-2 text-base text-muted">
            <li>1. Install the Mac app (above) and turn on FileVault in System Settings.</li>
            <li>2. In the app, open your name at the bottom left and choose <span className="text-ink">Keep data on this Mac</span></li>
            <li>3. Sign in with your school account and click Set up.</li>
          </ol>
        </section>

        <p className="mt-10 text-sm text-faint">Tip: in Safari, File → Add to Dock opens it in its own window.</p>
        <p className="mt-3 text-sm text-faint">
          <a href="/privacy" className="underline-offset-4 hover:text-ink hover:underline">
            How {PRODUCT_NAME} handles information
          </a>
        </p>
      </main>
    </div>
  );
}

function Option({ title, body, action, children }: { title: string; body: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="py-7">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-lg font-normal text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
