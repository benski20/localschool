import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ArrowUp, AudioLines, Calendar, Check, CircleCheck, Plus, Sparkles, User, X, ZoomIn } from "lucide-react";
import { CopyButton, EditableText, SaveHint, WordButton, useDraftOutput } from "../OutputEditor";
import { NotepadField, NotepadHint, useNotepad } from "../Notepad";
import { TranscriptView, clock, stamp, type TranscriptFocus } from "../TranscriptView";
import { ErrorLine } from "../ToolPage";
import {
  tools,
  type ActionItem,
  type Draft,
  type MeetingNotes as Notes,
  type NoteItem,
  type NoteSection,
  type Segment,
} from "../../../lib/tools";

/*
 * A finished meeting, laid out like a document: a serif title, a row of small chips, the notes
 * as a quiet outline, the transcript in a panel that slides in when asked for, and a floating
 * "Ask about this meeting" bar at the bottom.
 */

const isAction = (it: NoteItem | ActionItem): it is ActionItem => "task" in it;

export function notesText(n: Notes, sections: NoteSection[]): string {
  const out: string[] = [];
  for (const s of sections) {
    if (s.kind === "text") {
      if (n[s.key]) out.push(s.title, String(n[s.key]), "");
      continue;
    }
    const items = (n[s.key] as (NoteItem | ActionItem)[] | undefined) ?? [];
    if (!items.length) continue;
    out.push(s.title);
    for (const it of items) {
      if (isAction(it)) out.push(`- ${it.task}${it.owner || it.due ? ` (${[it.owner, it.due && `by ${it.due}`].filter(Boolean).join(", ")})` : ""}`);
      else out.push(`- ${it.text}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

/** "Today, 2:30 PM", "Yesterday", "Oct 9". */
function when(iso: string): string {
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return `Today, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Chip({ children, className, ...rest }: { children: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-sm text-muted";
  if (!rest.onClick) return <span className={clsx(base, className)}>{children}</span>;
  return (
    <button type="button" {...rest} className={clsx(base, "transition-colors hover:border-ink/25 hover:text-ink", className)}>
      {children}
    </button>
  );
}

export function MeetingDoc({
  draft,
  sections,
  typeLabel,
  onApproved,
  onRestart,
}: {
  draft: Draft<"meeting">;
  sections: NoteSection[];
  typeLabel?: string;
  onApproved: (d: Draft<"meeting">) => void;
  onRestart: (d: Draft<"meeting">) => void;
}) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  const segments = draft.transcript ?? [];
  const [focus, setFocus] = useState<TranscriptFocus | null>(null);
  const [panel, setPanel] = useState(false);
  const [view, setView] = useState<"enhanced" | "mine">("enhanced");
  const [approving, setApproving] = useState(false);
  const [failure, setFailure] = useState("");
  const recorded = draft.source === "audio";
  const jump = (index: number) => {
    setPanel(true);
    setFocus((f) => ({ index, n: (f?.n ?? 0) + 1 }));
  };

  if (!output) return null;
  const list = (key: string) => (output[key] as (NoteItem | ActionItem)[] | undefined) ?? [];
  const set = (patch: Partial<Notes>) => setOutput({ ...output, ...patch });
  const setItem = (key: string, i: number, patch: Partial<NoteItem & ActionItem>) =>
    set({ [key]: list(key).map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const removeItem = (key: string, i: number) => set({ [key]: list(key).filter((_, j) => j !== i) });
  const addAction = () => set({ action_items: [...output.action_items, { task: "", owner: "", due: null, refs: [] }] });

  const approve = async () => {
    setApproving(true);
    setFailure("");
    try {
      const clean = { ...output, action_items: output.action_items.filter((a) => a.task.trim()) };
      await tools.save<"meeting">(draft.id, clean);
      onApproved(await tools.approve<"meeting">(draft.id));
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setApproving(false);
    }
  };

  // Gray marks what the recording added to the teacher's own notes, so it only means
  // something when the teacher wrote notes.
  const all = sections.filter((s) => s.kind !== "text").flatMap((s) => list(s.key));
  const legend = Boolean(output.my_notes?.trim()) || (all.some((it) => it.mine === true) && all.some((it) => it.mine === false));
  const gray = (it: NoteItem | ActionItem) => legend && it.mine === false;
  const notepad = String(draft.input?.my_notes ?? output.my_notes ?? "");
  const shown = sections.filter((s) => s.kind !== "items" || list(s.key).length > 0);
  const last = segments[segments.length - 1];
  const text = () => notesText(output, sections);

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-8 sm:px-8 sm:pt-12">
      <Link to="/tools/meeting" className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-sm text-faint transition-colors hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Meetings
      </Link>

      <div className="mt-5 flex items-start justify-between gap-4">
        <h1 className="min-w-0 font-serif text-[32px] leading-[40px] tracking-[-0.01em] text-ink sm:text-[36px] sm:leading-[44px]">
          {draft.title || "Meeting notes"}
        </h1>
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <SaveHint state={saved} />
          <CopyButton text={text} />
          <WordButton title={draft.title || "Meeting notes"} text={text} className="hidden sm:inline-flex" />
        </div>
      </div>

      {/* Chips: which notes, when, who, and the way to the transcript. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {recorded ? (
          <span role="tablist" aria-label="Notes" className="inline-flex h-8 items-center rounded-full border border-line bg-subtle p-0.5 text-sm">
            {(
              [
                ["enhanced", "Enhanced", <Sparkles key="i" className="h-3.5 w-3.5" aria-hidden />],
                ["mine", "My notes", null],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                type="button"
                onClick={() => setView(key)}
                className={clsx(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-3 transition-[background-color,color,box-shadow] duration-fast",
                  view === key ? "bg-panel text-ink shadow-sm" : "text-faint hover:text-ink",
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </span>
        ) : null}
        <Chip>
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          {when(draft.created_at)}
        </Chip>
        {draft.student?.name && (
          <Chip>
            <User className="h-3.5 w-3.5" aria-hidden />
            {draft.student.name}
          </Chip>
        )}
        {typeLabel && <Chip className="hidden sm:inline-flex">{typeLabel}</Chip>}
        {segments.length > 0 && (
          <Chip onClick={() => setPanel((p) => !p)} aria-expanded={panel}>
            <AudioLines className="h-3.5 w-3.5" aria-hidden />
            Transcript
            {last?.end != null && <span className="tnum text-faint">{clock(last.end)}</span>}
          </Chip>
        )}
      </div>

      {view === "enhanced" ? (
        <div className="mt-10 animate-fade-in">
          {legend && <p className="mb-6 text-xs text-faint">Gray = added from the recording. Black = from your notes.</p>}
          <div className="space-y-9">
            {shown.map((s) => (
              <section key={s.key}>
                <h2 className="relative mb-2 text-lg font-medium text-ink">
                  <span aria-hidden className="absolute -left-6 top-0 hidden select-none text-faint/60 sm:inline">
                    #
                  </span>
                  {s.title}
                </h2>
                {s.kind === "text" ? (
                  <EditableText label={s.title} value={String(output[s.key] ?? "")} onChange={(v) => set({ [s.key]: v })} />
                ) : (
                  <ul className="space-y-0.5">
                    {list(s.key).map((it, i) => (
                      <OutlineRow
                        key={i}
                        action={isAction(it)}
                        refs={it.refs}
                        segments={segments}
                        onJump={jump}
                        onRemove={() => removeItem(s.key, i)}
                      >
                        {isAction(it) ? (
                          <ActionText item={it} gray={gray(it)} onChange={(p) => setItem(s.key, i, p)} />
                        ) : (
                          <EditableText
                            label={s.title}
                            value={it.text}
                            onChange={(t) => setItem(s.key, i, { text: t })}
                            tone={gray(it) ? "faint" : "ink"}
                            className="py-0.5"
                          />
                        )}
                      </OutlineRow>
                    ))}
                  </ul>
                )}
                {s.kind === "actions" && (
                  <button type="button" className="ml-6 mt-1 inline-flex items-center gap-1.5 text-sm text-faint transition-colors hover:text-ink" onClick={addAction}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add a to-do
                  </button>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <MyNotes
          id={draft.id}
          initial={notepad}
          usedText={output.my_notes ?? notepad}
          canUpdate={!draft.approved_at && segments.length > 0}
          onRestart={onRestart}
        />
      )}

      <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        {draft.approved_at ? (
          <Chip className="text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {recorded ? "Approved · recording deleted" : "Approved"}
          </Chip>
        ) : (
          <>
            <button type="button" className="btn-primary btn-sm rounded-full px-4" onClick={approve} disabled={approving}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Approve
            </button>
            {recorded && draft.has_audio && <span className="text-sm text-faint">Deletes the recording. The notes and transcript stay.</span>}
          </>
        )}
        {failure && <ErrorLine>{failure}</ErrorLine>}
      </div>

      <AskDock id={draft.id} segments={segments} onJump={jump} transcriptOpen={panel} onTranscript={() => setPanel((p) => !p)} />

      <TranscriptPanel open={panel} onClose={() => setPanel(false)} segments={segments} focus={focus} onFocus={jump} />
    </div>
  );
}

/** One bullet: a soft highlight on hover, the 🔍 (see where it was said) and ✕ on the right. */
function OutlineRow({
  action,
  refs,
  segments,
  onJump,
  onRemove,
  children,
}: {
  action?: boolean;
  refs?: number[];
  segments: Segment[];
  onJump: (i: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const first = (refs ?? []).find((r) => r >= 0 && r < segments.length);
  return (
    <li className="group relative -mx-2 flex items-start gap-2 rounded-md px-2 transition-colors duration-fast hover:bg-ink/[0.03] focus-within:bg-ink/[0.03]">
      <span aria-hidden className="flex h-[34px] w-4 shrink-0 items-center justify-center text-faint">
        {action ? <CircleCheck className="h-3.5 w-3.5" strokeWidth={1.6} /> : <span className="h-[5px] w-[5px] rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      <span className="flex h-[34px] shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {first !== undefined && (
          <button
            type="button"
            onClick={() => onJump(first)}
            className="btn-ghost btn-icon btn-sm text-faint hover:text-accent"
            aria-label={`Show where this was said (${stamp(segments[first]!, first)})`}
            title={`Said at ${stamp(segments[first]!, first)}`}
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <button type="button" onClick={onRemove} aria-label="Remove" className="btn-ghost btn-icon btn-sm text-faint">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    </li>
  );
}

/** A to-do, with who and by when as quiet inline text. */
function ActionText({ item, gray, onChange }: { item: ActionItem; gray?: boolean; onChange: (p: Partial<ActionItem>) => void }) {
  return (
    <div>
      <EditableText label="To-do" value={item.task} onChange={(task) => onChange({ task })} placeholder="What needs doing" tone={gray ? "faint" : "ink"} className="py-0.5" />
      <div className="-mt-1 flex flex-wrap items-baseline gap-x-1 text-sm text-faint">
        <span className="w-28">
          <EditableText single label="Who" value={item.owner} onChange={(owner) => onChange({ owner })} placeholder="Who" className="py-0 text-sm leading-[22px] text-muted" />
        </span>
        <span aria-hidden>·</span>
        <span className="w-28">
          <EditableText
            single
            label="By when"
            value={item.due ?? ""}
            onChange={(due) => onChange({ due: due.trim() ? due : null })}
            placeholder="By when"
            className="py-0 text-sm leading-[22px] text-muted"
          />
        </span>
      </div>
    </div>
  );
}

/** The teacher's own notes, editable; when they change, offer to rewrite the enhanced notes. */
function MyNotes({
  id,
  initial,
  usedText,
  canUpdate,
  onRestart,
}: {
  id: number;
  initial: string;
  usedText: string;
  canUpdate: boolean;
  onRestart: (d: Draft<"meeting">) => void;
}) {
  const notes = useNotepad(id, initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const changed = notes.text.trim() !== usedText.trim();

  const update = async () => {
    setBusy(true);
    setFailure("");
    try {
      await notes.flush();
      onRestart(await tools.retry<"meeting">(id));
    } catch (e) {
      setFailure((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-10 animate-fade-in">
      {changed && canUpdate && (
        <div className="mb-6 flex animate-slide-down flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-accent-soft px-4 py-2.5 text-sm text-ink">
          <span className="flex-1">Your notes changed.</span>
          <button type="button" className="btn-link" onClick={update} disabled={busy}>
            {busy ? "Updating…" : "Update enhanced notes"}
          </button>
          {failure && <ErrorLine>{failure}</ErrorLine>}
        </div>
      )}
      <div className="mb-2 flex h-5 justify-end">
        <NotepadHint state={notes.state} />
      </div>
      <NotepadField value={notes.text} onChange={notes.setText} className="min-h-[40vh] text-base leading-[28px]" placeholder="Your notes from the meeting" />
    </div>
  );
}

/** The transcript, sliding in from the right (a sheet from the bottom on phones). */
function TranscriptPanel({
  open,
  onClose,
  segments,
  focus,
  onFocus,
}: {
  open: boolean;
  onClose: () => void;
  segments: Segment[];
  focus: TranscriptFocus | null;
  onFocus: (i: number) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!segments.length) return null;
  const last = segments[segments.length - 1];
  return (
    <aside
      aria-label="Transcript"
      aria-hidden={!open}
      className={clsx(
        "fixed z-40 flex flex-col border-line bg-panel shadow-lg transition-[transform,opacity] duration-slow ease-out motion-reduce:transition-none",
        "inset-x-0 bottom-0 max-h-[70vh] rounded-t-xl border-t sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0",
        open ? "translate-x-0 translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0 sm:translate-x-6 sm:translate-y-0",
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 className="text-base font-medium text-ink">
          Transcript {last?.end != null && <span className="tnum ml-1 text-sm font-normal text-faint">{clock(last.end)}</span>}
        </h2>
        <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label="Close transcript" onClick={onClose} tabIndex={open ? 0 : -1}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <TranscriptView segments={segments} focus={focus} onFocus={onFocus} />
      </div>
    </aside>
  );
}

interface QA {
  question: string;
  answer: string;
  refs: number[];
  error?: boolean;
}

const SUGGESTION = "What are the next steps?";

/** Floating at the bottom: the transcript button, "Ask about this meeting", and a suggestion. */
function AskDock({
  id,
  segments,
  onJump,
  transcriptOpen,
  onTranscript,
}: {
  id: number;
  segments: Segment[];
  onJump: (i: number) => void;
  transcriptOpen: boolean;
  onTranscript: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<QA[]>([]);
  const [showAnswers, setShowAnswers] = useState(true);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const ready = segments.length > 0;

  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [asked.length, busy]);

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy || !ready) return;
    setBusy(true);
    setShowAnswers(true);
    setQuestion("");
    try {
      const r = await tools.askMeeting(id, q);
      setAsked((a) => [...a, { question: q, answer: r.answer, refs: r.refs ?? [] }]);
    } catch (err) {
      setAsked((a) => [...a, { question: q, answer: (err as Error).message, refs: [], error: true }]);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-16 bg-gradient-to-t from-bg from-60% to-transparent px-4 pb-5 pt-8 sm:-mx-8 sm:px-8">
      {showAnswers && (asked.length > 0 || busy) && (
        <div className="mb-3 max-h-[45vh] animate-slide-up overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-lg" aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <span className="label">About this meeting</span>
            <button type="button" className="btn-ghost btn-icon btn-sm text-faint" aria-label="Hide answers" onClick={() => setShowAnswers(false)}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <ul className="space-y-5">
            {asked.map((qa, i) => (
              <li key={i} className="animate-fade-in">
                <p className="text-sm font-medium text-ink">{qa.question}</p>
                <p className={clsx("mt-1 whitespace-pre-wrap text-base", qa.error ? "text-danger" : "text-muted")}>{qa.answer}</p>
                {qa.refs.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {qa.refs
                      .filter((r) => r >= 0 && r < segments.length)
                      .slice(0, 4)
                      .map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => onJump(r)}
                          className="tnum inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 font-mono text-2xs text-accent transition-colors hover:bg-accent-soft"
                        >
                          <ZoomIn className="h-3 w-3" aria-hidden />
                          {stamp(segments[r]!, r)}
                        </button>
                      ))}
                  </span>
                )}
              </li>
            ))}
            {busy && <li className="animate-pulse-soft text-sm text-faint">Looking through the meeting…</li>}
          </ul>
          <div ref={end} />
        </div>
      )}

      <div className="flex items-center gap-2">
        {ready && (
          <button
            type="button"
            onClick={onTranscript}
            aria-label={transcriptOpen ? "Hide transcript" : "Show transcript"}
            aria-pressed={transcriptOpen}
            className={clsx(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-panel shadow-md transition-colors",
              transcriptOpen ? "text-accent" : "text-muted hover:text-ink",
            )}
          >
            <AudioLines className="h-5 w-5" aria-hidden />
          </button>
        )}
        <form onSubmit={submit} className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-panel pl-5 pr-1.5 shadow-md focus-within:border-ink/30">
          <input
            ref={input}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
            aria-label="Question about this meeting"
            placeholder={ready ? "Ask about this meeting" : "You can ask once there's a transcript"}
            maxLength={500}
            value={question}
            disabled={!ready}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => asked.length && setShowAnswers(true)}
          />
          {question.trim() ? (
            <button type="submit" disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-bg transition-opacity disabled:opacity-40" aria-label="Ask">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            ready && (
              <button
                type="button"
                onClick={() => void ask(SUGGESTION)}
                disabled={busy}
                className="hidden h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-muted transition-colors hover:text-ink sm:inline-flex"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {SUGGESTION}
              </button>
            )
          )}
        </form>
      </div>
    </div>
  );
}
