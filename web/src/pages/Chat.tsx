import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, ArrowDown, Check, Copy, PenLine, RotateCcw } from "lucide-react";
import { api, streamChat } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import { PRODUCT_NAME } from "../lib/brand";
import type { Message, Source } from "../lib/types";
import { Answer } from "../components/Answer";
import { SourcePanel } from "../components/SourcePanel";
import { CONVERSATIONS_CHANGED } from "../components/Sidebar";
import { Composer, type ComposerHandle } from "../components/chat/Composer";
import { Eyebrow, Welcome } from "../components/chat/Welcome";
import { CiteNumber, SourceKindIcon, SourceKindLabel } from "../components/chat/SourceKind";
import { useSmoothText } from "../components/chat/useSmoothText";
import "../components/chat/chat.css";

const DRAFT_KEY = "ls-draft";
const STICK_PX = 96; // within this distance of the bottom we keep following the stream

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
  const { status, refresh: refreshStatus } = useStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(readDraft);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ messageId: Message["id"]; n: number } | null>(null);
  const [pinned, setPinned] = useState(true); // following the bottom of the conversation
  const conversationId = useRef<number | null>(id ? Number(id) : null);
  const justCreated = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const hasMessages = useRef(false);
  const composer = useRef<ComposerHandle>(null);

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
    stick.current = true;
    setPinned(true);
    if (cid === null) {
      setMessages([]);
      composer.current?.focus();
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

  // --- scroll: follow the stream unless the reader has scrolled up -------------------
  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    const up = el.scrollTop < lastTop.current - 1;
    lastTop.current = el.scrollTop;
    // Only the reader scrolling up detaches us; our own (smooth) scrolling never does.
    if (near) stick.current = true;
    else if (up) stick.current = false;
    setPinned(near || stick.current);
  };

  // Content grows every frame while text is revealed; keep up with it if pinned.
  useLayoutEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current && hasMessages.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

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
    // Asking is an explicit "take me to the answer".
    stick.current = true;
    setPinned(true);
    requestAnimationFrame(() => toBottom(true));

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
              update(aid, () => ({ sources: e.sources, notice: undefined }));
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
      setMessages((ms) => ms.map((m) => (m.id === aid && m.pending ? { ...m, pending: false, stopped: ctl.signal.aborted } as Message : m)));
      setBusy(false);
      abort.current = null;
      refreshStatus();
      composer.current?.focus();
    }
  }

  const activeMessage = active ? messages.find((m) => m.id === active.messageId) : null;
  const activeSource = activeMessage?.sources.find((s) => s.n === active?.n) ?? null;
  const firstName = user?.name.split(" ")[0] ?? "";
  const closePanel = useCallback(() => setActive(null), []);
  const empty = !loading && messages.length === 0;
  hasMessages.current = messages.length > 0;
  const turns = toTurns(messages);

  const composerProps = {
    ref: composer,
    value: draft,
    onChange: setDraft,
    onSubmit: () => ask(draft),
    onStop: () => abort.current?.abort(),
    busy,
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div ref={content}>
            {loading ? (
              <ConversationSkeleton />
            ) : empty ? (
              <Welcome
                name={firstName}
                school={status?.school ?? ""}
                status={status}
                isAdmin={user?.role === "admin"}
                onPick={(q) => ask(q)}
                composer={(children) => (
                  <Composer {...composerProps} variant="hero">
                    {children}
                  </Composer>
                )}
              />
            ) : (
              <div className="mx-auto w-full max-w-[800px] px-4 pb-12 pt-8 md:px-10 md:pt-12">
                {turns.map((t, i) => (
                  <Turn
                    key={t.answer?.id ?? t.question?.id ?? i}
                    question={t.question}
                    answer={t.answer}
                    first={i === 0}
                    isLast={i === turns.length - 1}
                    busy={busy}
                    activeN={t.answer && active?.messageId === t.answer.id ? active.n : null}
                    onCite={(n) => {
                      const a = t.answer;
                      if (a) setActive(active?.messageId === a.id && active.n === n ? null : { messageId: a.id, n });
                    }}
                    onRetry={() => t.question && ask(t.question.content)}
                    onEdit={() => {
                      if (!t.question) return;
                      setDraft(t.question.content);
                      composer.current?.focus();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {!empty && (
          <div className="relative shrink-0 border-t border-line bg-bg px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:px-10 md:pb-4 md:pt-4">
            <div className="relative mx-auto w-full max-w-[720px]">
              <button
                type="button"
                onClick={() => {
                  stick.current = true;
                  setPinned(true);
                  toBottom(true);
                }}
                tabIndex={pinned ? -1 : 0}
                aria-hidden={pinned}
                className={clsx(
                  "absolute -top-[52px] left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-[2px] border border-line-strong bg-panel px-3 text-xs font-medium text-muted transition-[opacity,transform] duration-200 ease-out hover:text-ink",
                  pinned ? "pointer-events-none translate-y-1 opacity-0" : "translate-y-0 opacity-100",
                )}
              >
                <ArrowDown className="h-3.5 w-3.5" />
                {busy ? "New text below" : "Jump to latest"}
              </button>
              <Composer {...composerProps} placeholder="Ask a follow-up…" />
              <p className="mt-2 hidden text-center text-[11.5px] text-faint sm:block">
                {PRODUCT_NAME} answers from your school's documents and your roster. Review before acting on them.
              </p>
            </div>
          </div>
        )}
      </div>

      <SourcePanel
        open={!!activeSource}
        source={activeSource}
        sources={activeMessage?.sources ?? []}
        onSelect={(n) => activeMessage && setActive({ messageId: activeMessage.id, n })}
        onClose={closePanel}
      />
    </div>
  );
}

type ChatMsg = Message & { stopped?: boolean };

/** Pair each question with the answer that follows it. */
function toTurns(ms: ChatMsg[]) {
  const out: { question?: ChatMsg; answer?: ChatMsg }[] = [];
  for (const m of ms) {
    if (m.role === "user") out.push({ question: m });
    else if (out.length && !out[out.length - 1].answer) out[out.length - 1].answer = m;
    else out.push({ answer: m });
  }
  return out;
}

function ConversationSkeleton() {
  return (
    <div className="chat-fade mx-auto w-full max-w-[800px] space-y-4 px-4 pt-12 md:px-10" aria-label="Loading conversation">
      <div className="chat-line h-6 w-2/3" />
      <div className="space-y-2.5 pt-4">
        <div className="chat-line h-3.5 w-full" />
        <div className="chat-line h-3.5 w-11/12" />
        <div className="chat-line h-3.5 w-3/5" />
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  return { copied, copy };
}

function TextAction({ onClick, disabled, children, label }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-[12.5px] text-faint transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Uppercase colored status text, like CERTIFIED / DECLINED in the reference. */
function TurnStatus({ a }: { a?: ChatMsg }) {
  if (!a) return null;
  let text: string;
  let tone: string;
  if (a.pending) {
    text = a.content ? "Writing" : a.sources.length ? "Reading sources" : "Searching";
    tone = "text-accent";
  } else if (a.error) {
    text = "Failed";
    tone = "text-danger";
  } else if (a.stopped) {
    text = "Stopped";
    tone = "text-warning";
  } else if (a.sources.length) {
    text = `Cited · ${a.sources.length}`;
    tone = "text-success";
  } else {
    text = "No source found";
    tone = "text-warning";
  }
  return (
    <span key={text} className={clsx("chat-fade shrink-0 whitespace-nowrap pt-[7px] text-[11px] font-medium uppercase tracking-[0.08em]", tone)}>
      {text}
    </span>
  );
}

function Turn({
  question,
  answer: m,
  first,
  isLast,
  busy,
  activeN,
  onCite,
  onRetry,
  onEdit,
}: {
  question?: ChatMsg;
  answer?: ChatMsg;
  first: boolean;
  isLast: boolean;
  busy: boolean;
  activeN: number | null;
  onCite: (n: number) => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const { copied, copy } = useCopy();
  const text = useSmoothText(m?.content ?? "", !!m?.pending);
  const waiting = m?.pending && !text;
  const done = !!m && !m.pending && !m.error && !!m.content;

  return (
    <section className={clsx("group chat-rise", !first && "mt-10 border-t border-line pt-10")}>
      {question && (
        <div className="flex items-start justify-between gap-6">
          <h2 className="min-w-0 whitespace-pre-wrap text-[19px] font-normal leading-[1.45] tracking-[-0.01em] text-ink md:text-[20px]">
            {question.content}
          </h2>
          <TurnStatus a={m} />
        </div>
      )}

      {m && (
        <div className="mt-5">
          {waiting ? (
            <Progress m={m} />
          ) : m.error ? (
            <div className="flex items-start gap-3 border border-danger/30 bg-panel px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-ink">The assistant couldn't answer</div>
                <div className="mt-0.5 text-muted">{m.error}</div>
              </div>
              {isLast && question && (
                <button className="btn-secondary h-7 shrink-0 rounded-[2px] text-xs" onClick={onRetry} disabled={busy}>
                  <RotateCcw className="h-3 w-3" /> Try again
                </button>
              )}
            </div>
          ) : (
            <Answer text={text} sources={m.sources} streaming={m.pending} activeSource={activeN} onCite={onCite} />
          )}

          {!m.pending && m.stopped && !m.error && m.content && <div className="mt-3 text-xs text-faint">Stopped — the answer above is incomplete.</div>}

          {done && m.sources.length > 0 && <SourceList sources={m.sources} activeN={activeN} onCite={onCite} />}

          {done && (
            <div
              className={clsx(
                "chat-actions -ml-2 mt-4 flex flex-wrap items-center gap-0.5 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
                isLast ? "opacity-100" : "opacity-0",
              )}
            >
              <TextAction onClick={() => copy(m.content.replace(/\s?\[\d+\]/g, ""))} label={copied ? "Copied" : "Copy answer"}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {copied ? "Copied" : "Copy"}
              </TextAction>
              {isLast && question && (
                <TextAction onClick={onRetry} disabled={busy}>
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Ask again
                </TextAction>
              )}
              {question && (
                <TextAction onClick={onEdit}>
                  <PenLine className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Edit question
                </TextAction>
              )}
              {m.model && <span className="ml-auto truncate pl-3 font-mono text-[11px] text-faint">{m.model}</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** "Searching your documents…" → "Writing…": a shimmer, never a spinner. */
function Progress({ m }: { m: Message }) {
  const found = m.sources.length;
  const label = m.notice ?? (found ? "Writing…" : "Searching your documents…");
  return (
    <div className="chat-fade" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span key={label} className="chat-shimmer-text chat-fade text-[14px] font-medium">
          {label}
        </span>
        {found > 0 && !m.notice && (
          <span className="chat-fade text-xs text-faint">
            {found} source{found === 1 ? "" : "s"} found
          </span>
        )}
      </div>
      {found > 0 && (
        <div className="chat-stagger mt-3 flex flex-wrap gap-1.5">
          {m.sources.slice(0, 5).map((s) => (
            <span key={s.n} className="inline-flex h-7 max-w-[240px] items-center gap-2 rounded-[2px] border border-line bg-panel px-2 text-[12px] text-muted">
              <SourceKindIcon kind={s.kind} className="h-4 w-4 border-0" />
              <span className="truncate">{s.title}</span>
            </span>
          ))}
          {found > 5 && <span className="inline-flex h-7 items-center px-1 text-[12px] text-faint">+{found - 5} more</span>}
        </div>
      )}
      <div className="mt-5 max-w-[68ch] space-y-3" aria-hidden>
        <div className="chat-line h-2.5 w-full" />
        <div className="chat-line h-2.5 w-[92%]" />
        <div className="chat-line h-2.5 w-[64%]" />
      </div>
    </div>
  );
}

function SourceList({ sources, activeN, onCite }: { sources: Source[]; activeN: number | null; onCite: (n: number) => void }) {
  return (
    <div className="mt-7 max-w-[68ch]">
      <Eyebrow className="mb-2.5">Sources</Eyebrow>
      <div className="chat-stagger border border-line bg-panel">
        {sources.map((s, i) => (
          <button
            key={s.n}
            onClick={() => onCite(s.n)}
            aria-pressed={activeN === s.n}
            className={clsx(
              "flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150",
              i > 0 && "border-t border-line",
              activeN === s.n ? "bg-accent-soft/70" : "hover:bg-bg",
            )}
          >
            <CiteNumber n={s.n} active={activeN === s.n} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
              {s.title}
              {s.subtitle && <span className="text-faint"> · {s.subtitle}</span>}
            </span>
            <SourceKindLabel kind={s.kind} className="hidden sm:inline-flex" />
          </button>
        ))}
      </div>
    </div>
  );
}
