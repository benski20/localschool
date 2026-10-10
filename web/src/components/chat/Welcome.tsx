import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { api, relativeTime } from "../../lib/api";
import type { ConversationSummary, Status } from "../../lib/types";
import { CONVERSATIONS_CHANGED } from "../Sidebar";

export const SUGGESTIONS: { group: string; prompts: string[] }[] = [
  {
    group: "Your classes",
    prompts: [
      "Which of my students have extended-time accommodations?",
      "Is the Unit 2 test before any of my students' plan reviews?",
      "Which of my students are English learners?",
    ],
  },
  {
    group: "School policies",
    prompts: [
      "What is the late work policy for students with an IEP?",
      "How do I schedule a test in a separate setting?",
      "What are the steps for requesting a 504 plan review?",
    ],
  },
];

const STEPS = [
  { t: "Search your documents", d: "Your question is matched against the school's handbooks, policies and curriculum." },
  { t: "Read your roster", d: "If it's about your students, their plans and accommodations are pulled in too." },
  { t: "Answer", d: "A private model writes a short answer from those sources only." },
  { t: "Cite", d: "Every claim links to the exact passage or student record it came from." },
];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint", className)}>{children}</div>;
}

/**
 * First-question screen: a calm page title, the question form with outlined
 * suggestions, and (on wide screens) a gray rail with recent questions and how it works.
 */
export function Welcome({
  name,
  school,
  status,
  isAdmin,
  onPick,
  composer,
}: {
  name: string;
  school: string;
  status: Status | null;
  isAdmin: boolean;
  onPick: (q: string) => void;
  composer: (children: ReactNode) => ReactNode;
}) {
  const [recent, setRecent] = useState<ConversationSummary[] | null>(null);
  useEffect(() => {
    const load = () =>
      api
        .get<{ conversations: ConversationSummary[] }>("/api/conversations")
        .then((r) => setRecent(r.conversations))
        .catch(() => setRecent([]));
    load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-8 md:px-10 md:pt-12">
      <header className="chat-fade">
        <h1 className="text-[26px] font-normal leading-[1.2] tracking-[-0.015em] text-ink md:text-[28px]">Ask</h1>
        <p className="mt-2 text-[15px] leading-[1.55] text-muted">
          One question in. A cited answer out, grounded in {school ? `${school}'s` : "your school's"} documents and your roster.
        </p>
      </header>

      <div className="chat-fade mt-7 grid border border-line bg-panel lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 px-4 py-6 md:px-10 md:py-9">
          <Eyebrow>New question</Eyebrow>
          <h2 className="mt-1.5 text-[21px] font-normal leading-[1.3] tracking-[-0.01em] text-ink md:text-[22px]">
            {greeting()}
            {name ? `, ${name}` : ""}. What do you need to know?
          </h2>

          <div className="mt-7">
            {composer(
              <>
                <div className="mt-6 space-y-5">
                  {SUGGESTIONS.map((g) => (
                    <div key={g.group}>
                      <Eyebrow className="mb-2">{g.group}</Eyebrow>
                      <div className="chat-stagger flex flex-wrap gap-2">
                        {g.prompts.map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => onPick(q)}
                            className="max-w-full rounded-[2px] border border-line bg-panel px-3.5 py-2 text-left text-[13.5px] leading-[20px] text-muted sm:truncate transition-colors hover:border-line-strong hover:bg-bg hover:text-ink"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <RuntimeRow status={status} isAdmin={isAdmin} />
              </>,
            )}
          </div>
        </section>

        <aside className="border-t border-line bg-subtle/60 px-4 py-6 md:px-10 lg:border-l lg:border-t-0 lg:px-8 lg:py-9">
          <Eyebrow>Recent</Eyebrow>
          <div className="mt-3 space-y-2">
            {recent === null ? (
              [0, 1].map((i) => <div key={i} className="chat-line h-[62px] border border-line" />)
            ) : recent.length === 0 ? (
              <p className="border border-dashed border-line-strong px-4 py-4 text-[13px] text-faint">Your questions will appear here.</p>
            ) : (
              recent.slice(0, 3).map((c) => (
                <Link
                  key={c.id}
                  to={`/chat/${c.id}`}
                  className="block border border-line bg-panel px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <div className="line-clamp-2 text-[14px] leading-[20px] text-ink">{c.title}</div>
                  <div className="mt-1 text-[11.5px] text-faint">{relativeTime(c.updated_at)}</div>
                </Link>
              ))
            )}
          </div>

          <Eyebrow className="mt-9">How it works</Eyebrow>
          <ol className="mt-4 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.t} className="grid grid-cols-[28px_1fr] gap-x-2">
                <span className="pt-[2px] font-mono text-[12.5px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-[15px] text-ink">{s.t}</div>
                  <p className="mt-0.5 text-[13px] leading-[20px] text-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

/** Mirrors the reference's "Model account connected · Change" row, using last-known status only. */
function RuntimeRow({ status, isAdmin }: { status: Status | null; isAdmin: boolean }) {
  if (!status) return <div className="mt-6 h-[50px] border border-line chat-line" aria-hidden />;
  const s = status.runtime.state;
  const indexing = !status.index.ready || status.index.syncing;
  const icon =
    s === "unreachable" ? (
      <CircleAlert className="h-4 w-4 text-danger" strokeWidth={1.75} />
    ) : s === "idle" ? (
      <CircleDashed className="h-4 w-4 text-faint" strokeWidth={1.75} />
    ) : (
      <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.75} />
    );
  const label = s === "unreachable" ? "Assistant unreachable" : s === "idle" ? "Assistant idle — wakes on your first question" : "Assistant connected";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border border-line px-4 py-3 text-[14px]">
      {icon}
      <span className="text-ink">{label}</span>
      <span className="font-mono text-[12px] text-faint">({status.models.chat})</span>
      {indexing && (
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-warning">
          Indexing {status.index.embedded_chunks}/{status.index.total_chunks}
        </span>
      )}
      {isAdmin && (
        <Link to="/admin" className="ml-auto text-[13.5px] text-accent hover:underline">
          Change
        </Link>
      )}
    </div>
  );
}
