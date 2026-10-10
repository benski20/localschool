import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Globe, Keyboard, PanelTop } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { Logo } from "../components/Logo";

/** Public page (/get): the ways to open Local School, easiest first. No sign-in needed. */
export function GetApp() {
  const [school, setSchool] = useState("Local School");
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const command = `curl -fsSL ${origin}/install/mac.sh | bash`;
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);

  useEffect(() => {
    api
      .get<{ school?: string }>("/api/health")
      .then((h) => {
        if (h.school) setSchool(h.school);
      })
      .catch(() => undefined);
  }, []);

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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[560px] animate-fadein px-4 py-14">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={40} />
          <h1 className="mt-5 text-xl text-ink">Get Local School</h1>
          <p className="mt-1.5 text-sm text-muted">{school} · private AI for your school</p>
        </div>

        <div className="space-y-3">
          <Option icon={<Globe className="h-4 w-4" />} title="Use it in your browser" tag="Easiest" body="Nothing to install. Works in Safari, Chrome, and Edge.">
            <a href="/" className="btn-primary h-9 shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          </Option>

          <Option
            icon={<PanelTop className="h-4 w-4" />}
            title="Keep it in your Dock"
            body={
              safari
                ? "In Safari's menu bar choose File → Add to Dock. It opens in its own window, like an app."
                : "In Safari choose File → Add to Dock. In Chrome: ⋮ → Cast, save, and share → Install page as app."
            }
          />

          <Option icon={<Keyboard className="h-4 w-4" />} title="Install the Mac app" body="Adds ⌥ Space to ask from anywhere. Open Terminal, paste this line, and press Return.">
            <div className="mt-3 flex w-full items-center gap-2 rounded-md border border-line bg-subtle p-1.5 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={command}>
                {command}
              </code>
              <button type="button" className="btn-secondary h-7 shrink-0 px-2 text-xs" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </Option>
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          Saw “Not Opened” after downloading from the browser? Use the Terminal line above instead. It installs without that warning.
        </p>
      </div>
    </div>
  );
}

function Option({ icon, title, body, tag, children }: { icon: ReactNode; title: string; body: string; tag?: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          {title}
          {tag && <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted">{tag}</span>}
        </div>
        <div className="text-xs text-muted">{body}</div>
      </div>
      {children}
    </div>
  );
}
