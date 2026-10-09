import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowUp, Check, Copy, FileText, Square, UserRound } from "lucide-react";
import { api, streamChat } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { Message, Source } from "../lib/types";
import { Answer } from "../components/Answer";
import { SourcePanel } from "../components/SourcePanel";
import { CONVERSATIONS_CHANGED } from "../components/Sidebar";
import { Skeleton, Spinner } from "../components/ui";

const DRAFT_KEY = "ls-draft";
const STARTERS = [
  "Which of my students have extended-time accommodations?",
  "What is the late work policy for students with an IEP?",
  "Is the Unit 2 test before any of my students' plan reviews?",
  "How do I schedule a test in a separate setting?",
];

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(v: string) {
  try {
    if (v) localStorage.setItem(DRAFT_KEY, v);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh: refreshStatus } = useStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(readDraft);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ messageId: Message["id"]; n: number } | null>(null);
  const conversationId = useRef<number | null>(id ? Number(id) : null);
  const justCreated = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Load a conversation when the route changes (but not the one we're streaming into).
  useEffect(() => {
    const cid = id ? Number(id) : null;
    conversationId.current = cid;
    if (cid !== null && justCreated.current === cid) {
      justCreated.current = null; // only skip the reload caused by our own navigate()
      return;
    }
    abort.current?.abort();
    setActive(null);
    if (cid === null) {
      setMessages([]);
      input.current?.focus();
      return;
    }
    setLoading(true);
    api
      .get<{ messages: Message[] }>(`/api/conversations/${cid}`)
      .then((r) => setMessages(r.messages))
      .catch(() => navigate("/chat", { replace: true }))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => writeDraft(draft), [draft]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [draft]);

  const scrollToEnd = useCallback(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(scrollToEnd, [messages, scrollToEnd]);

  const update = (mid: string, patch: (m: Message) => Partial<Message>) =>
    setMessages((ms) => ms.map((m) => (m.id === mid ? { ...m, ...patch(m) } : m)));

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    setBusy(true);
    setDraft("");
    setActive(null);
    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;
    setMessages((ms) => [
      ...ms,
      { id: uid, role: "user", content: question, sources: [] },
      { id: aid, role: "assistant", content: "", sources: [], pending: true },
    ]);
    requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });

    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await streamChat(
        { question, conversation_id: conversationId.current },
        (e) => {
          switch (e.type) {
            case "conversation":
              if (conversationId.current !== e.id) {
                conversationId.current = e.id;
                justCreated.current = e.id;
                navigate(`/chat/${e.id}`, { replace: true });
              }
              window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
              break;
            case "sources":
              update(aid, () => ({ sources: e.sources, notice: e.sources.length ? `Found ${e.sources.length} relevant source${e.sources.length === 1 ? "" : "s"}` : "No matching sources" }));
              break;
            case "queued":
              update(aid, () => ({ notice: `Waiting for the GPU — you're #${e.position} in line` }));
              break;
            case "status":
              update(aid, () => ({ notice: e.message }));
              break;
            case "token":
              update(aid, (m) => ({ content: m.content + e.text, notice: undefined }));
              break;
            case "done":
              update(aid, () => ({ id: e.message_id, content: e.content, sources: e.sources, model: e.model, pending: false, notice: undefined }));
              break;
            case "error":
              update(aid, () => ({ pending: false, error: e.message, notice: undefined }));
              break;
          }
        },
        ctl.signal,
      );
    } catch (err) {
      if (!ctl.signal.aborted) update(aid, () => ({ pending: false, error: (err as Error).message }));
    } finally {
      setMessages((ms) => ms.map((m) => (m.id === aid && m.pending ? { ...m, pending: false } : m)));
      setBusy(false);
      abort.current = null;
      refreshStatus();
      input.current?.focus();
    }
  }

  const activeMessage = active ? messages.find((m) => m.id === active.messageId) : null;
  const activeSource = activeMessage?.sources.find((s) => s.n === active?.n) ?? null;
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-4 pb-8 pt-8 md:px-6 md:pt-10">
            {loading ? (
              <div className="space-y-6">
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : messages.length === 0 ? (
              <Welcome name={firstName} onPick={(q) => ask(q)} />
            ) : (
              <div className="space-y-8">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end animate-fadein">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-subtle px-4 py-2.5 text-md text-ink">{m.content}</div>
                    </div>
                  ) : (
                    <AssistantTurn
                      key={m.id}
                      m={m}
                      activeN={active?.messageId === m.id ? active.n : null}
                      onCite={(n) => setActive(active?.messageId === m.id && active.n === n ? null : { messageId: m.id, n })}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-transparent bg-gradient-to-t from-bg via-bg to-bg/0 px-4 pb-4 pt-2 md:px-6 md:pb-5">
          <form
            className="mx-auto w-full max-w-[720px]"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-line bg-panel p-2 pl-4 shadow-card transition-colors focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
              <label htmlFor="ask" className="sr-only">
                Ask a question
              </label>
              <textarea
                id="ask"
                ref={input}
                rows={1}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
                placeholder="Ask about your policies, curriculum, or students…"
                className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-md text-ink placeholder:text-faint focus:outline-none"
              />
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} className="btn-secondary h-8 w-8 shrink-0 rounded-lg px-0" aria-label="Stop generating">
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button type="submit" disabled={!draft.trim()} className="btn-primary h-8 w-8 shrink-0 rounded-lg px-0" aria-label="Send">
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-faint">
              Answers cite your documents and roster. Always review before acting on them.
            </p>
          </form>
        </div>
      </div>

      {activeSource && activeMessage && (
        <SourcePanel
          source={activeSource}
          sources={activeMessage.sources}
          onSelect={(n) => setActive({ messageId: activeMessage.id, n })}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function Welcome({ name, onPick }: { name: string; onPick: (q: string) => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="pt-[12vh] animate-fadein">
      <h1 className="text-xl text-ink">
        {greeting}
        {name ? `, ${name}` : ""}.
      </h1>
      <p className="mt-1.5 text-md text-muted">Ask anything about your school's documents or your classes. Every answer links to its source.</p>
      <div className="mt-8 grid gap-2 sm:grid-cols-2">
        {STARTERS.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-lg border border-line bg-panel px-4 py-3 text-left text-sm text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssistantTurn({ m, activeN, onCite }: { m: Message; activeN: number | null; onCite: (n: number) => void }) {
  const [copied, setCopied] = useState(false);
  const waiting = m.pending && !m.content;
  return (
    <div className="animate-fadein">
      {waiting ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="text-faint" />
            {m.notice ?? "Searching your documents…"}
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : m.error ? (
        <div className="rounded-lg border border-danger/25 bg-danger/[0.04] px-4 py-3 text-sm">
          <div className="font-medium text-danger">The assistant couldn't answer</div>
          <div className="mt-0.5 text-muted">{m.error}</div>
        </div>
      ) : (
        <Answer text={m.content} sources={m.sources} streaming={m.pending} activeSource={activeN} onCite={onCite} />
      )}

      {!m.pending && !m.error && m.content && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {m.sources.map((s: Source) => (
            <button
              key={s.n}
              onClick={() => onCite(s.n)}
              className={clsx(
                "inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                activeN === s.n ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              <span className="font-semibold tabular-nums">{s.n}</span>
              {s.kind === "document" ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <UserRound className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{s.title}</span>
              {s.page ? <span className="shrink-0 text-faint">p.{s.page}</span> : null}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 text-xs text-faint">
            {m.model && <span className="font-mono">{m.model}</span>}
            <button
              className="btn-ghost h-7 w-7 px-0"
              aria-label="Copy answer"
              onClick={() => {
                navigator.clipboard?.writeText(m.content.replace(/\[\d+\]/g, "")).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
