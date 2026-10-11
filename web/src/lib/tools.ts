/**
 * Tools API client. The shapes mirror the server's reference (docstring of app/routes/tools.py).
 *
 *   GET    /api/tools                     → ToolsMeta (meeting types + sections, adapt levels, limits)
 *   POST   /api/tools/{tool}/drafts       json or multipart → { draft, drafts, batch, errors }
 *   GET    /api/tools/{tool}/drafts       ?batch= → { drafts: DraftSummary[], batch: BatchProgress|null }
 *   GET    /api/drafts/{id}               → { draft }   (poll while queued/running)
 *   PUT    /api/drafts/{id}               { output?, title? } → { draft }   (409 while queued/running)
 *   POST   /api/drafts/{id}/approve       → { draft }   (meeting: deletes the recording)
 *   POST   /api/drafts/{id}/retry         → { draft }
 *   DELETE /api/drafts/{id}               → { ok }
 *   POST   /api/meetings/{id}/audio       multipart file + offset/final/consent, ?track=mic|call → { draft, received }
 *   PUT    /api/meetings/{id}/notepad     { text } → { ok }   (the teacher's own notes; any status)
 *   POST   /api/meetings/{id}/ask         { question } → { answer, refs }   (409 before a transcript)
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export type ToolKey = "meeting" | "feedback" | "adapt" | "email";
export type DraftStatus = "awaiting_audio" | "queued" | "running" | "ready" | "error";
export type Stage = "" | "starting" | "waiting" | "transcribing" | "writing";

/* ---------- GET /api/tools ---------- */

export type MeetingType = "iep" | "parent_conference" | "sst" | "plc" | "other";
export interface NoteSection {
  key: string;
  title: string;
  kind: "text" | "items" | "actions";
}
export interface ToolsMeta {
  tools: ToolKey[];
  meeting_types: { key: MeetingType; label: string; sections: NoteSection[] }[];
  adapt_levels: { key: string; label: string }[];
  email_tones: Tone[];
  audio: { accept: string[]; max_bytes: number; chunk_bytes: number; tracks?: AudioTrack[] };
  limits: { feedback_pieces: number; work_chars: number; reading_chars: number; adapt_versions: number };
}

let metaCache: Promise<ToolsMeta> | null = null;
export const loadMeta = () =>
  (metaCache ??= api.get<ToolsMeta>("/api/tools").catch((e) => {
    metaCache = null;
    throw e;
  }));

export function useToolsMeta(): ToolsMeta | null {
  const [meta, setMeta] = useState<ToolsMeta | null>(null);
  useEffect(() => {
    let alive = true;
    loadMeta()
      .then((m) => alive && setMeta(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return meta;
}

/* ---------- Meeting notes ---------- */

/** "mic" is the teacher's microphone; "call" is the computer's sound (Mac app only). */
export type AudioTrack = "mic" | "call";

export interface MeetingCreate {
  meeting_type: MeetingType;
  student_id?: number | null;
  title?: string;
  consent?: boolean;
  transcript_text?: string;
}

/** One transcript line. start/end are seconds, or null for a pasted transcript without times. */
export interface Segment {
  i: number;
  start: number | null;
  end: number | null;
  text: string;
  /** Present when a call track was recorded: "You" (microphone) or "Others" (call audio). */
  speaker?: "You" | "Others";
}

export interface NoteItem {
  text: string;
  refs: number[];
  /** True when it came from the teacher's own notes; false when added from the recording. */
  mine?: boolean;
}
export interface ActionItem {
  owner: string;
  task: string;
  due: string | null;
  refs: number[];
  mine?: boolean;
}
export interface MeetingNotes {
  meeting_type: MeetingType;
  summary: string;
  action_items: ActionItem[];
  /** The teacher's notepad as it was when these notes were written. */
  my_notes?: string;
  [section: string]: unknown;
}

/* ---------- Feedback ---------- */

export interface FeedbackCreate {
  work?: string;
  title?: string;
  works?: { title: string; text: string }[];
  rubric_document_id?: number;
  rubric_text?: string;
  focus?: string;
  student_id?: number | null;
}
export interface FeedbackItem {
  comment: string;
  quote: string;
  span: [number, number] | null;
  rubric_line: number;
  rubric: string;
}
export interface FeedbackOutput {
  strengths: FeedbackItem[];
  next_steps: FeedbackItem[];
  focus: string;
  dropped: number;
}

/* ---------- Adapt a reading ---------- */

export interface AdaptVersionIn {
  level?: string;
  student_id?: number;
  language?: string;
}
export interface AdaptCreate {
  text: string;
  title?: string;
  versions: AdaptVersionIn[];
}
export interface Readability {
  words: number;
  grade: number | null;
}
export interface AdaptVersion {
  label: string;
  level: string;
  language: string;
  student: { id: number; name: string } | null;
  title: string;
  text: string;
  glossary: { term: string; meaning: string }[];
  changes: string;
  readability: Readability;
}
export interface AdaptOutput {
  original: Readability;
  versions: AdaptVersion[];
}

/* ---------- Parent email ---------- */

export type Tone = "warm" | "neutral" | "firm";
export interface EmailCreate {
  student_id: number;
  topic: string;
  tone: Tone;
  language: string;
}
export interface EmailOutput {
  subject: string;
  body: string;
  language: string;
}

/* ---------- Drafts ---------- */

export interface ToolIO {
  meeting: { create: MeetingCreate; output: MeetingNotes };
  feedback: { create: FeedbackCreate; output: FeedbackOutput };
  adapt: { create: AdaptCreate; output: AdaptOutput };
  email: { create: EmailCreate; output: EmailOutput };
}

export interface DraftSummary {
  id: number;
  tool: ToolKey;
  title: string;
  status: DraftStatus;
  stage: Stage;
  /** 0–1 */
  progress: number;
  error: string;
  queue_position: number | null;
  student: { id: number | null; name: string } | null;
  batch: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  approved_at: string | null;
  preview?: string;
  /* meeting */
  meeting_type?: MeetingType;
  source?: "audio" | "paste";
  has_audio?: boolean;
  audio_bytes?: number;
}

export interface Draft<T extends ToolKey = ToolKey> extends DraftSummary {
  tool: T;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  output: ToolIO[T]["output"] | null;
  transcript?: Segment[] | null;
  sections?: NoteSection[];
  mailto?: string | null;
}

export interface BatchProgress {
  id: string;
  total: number;
  ready: number;
  error: number;
  active: number;
  done: boolean;
  progress: number;
}

export interface Created<T extends ToolKey> {
  draft: Draft<T>;
  drafts: Draft<T>[];
  batch: string | null;
  errors: { filename: string; error: string }[];
}

export const tools = {
  list: (tool: ToolKey) =>
    api.get<{ drafts: DraftSummary[] }>(`/api/tools/${tool}/drafts`).then((r) => r.drafts),

  batch: (tool: ToolKey, batch: string) =>
    api.get<{ drafts: DraftSummary[]; batch: BatchProgress | null }>(
      `/api/tools/${tool}/drafts?batch=${encodeURIComponent(batch)}`,
    ),

  get: <T extends ToolKey>(id: number) => api.get<{ draft: Draft<T> }>(`/api/drafts/${id}`).then((r) => r.draft),

  create: <T extends ToolKey>(tool: T, body: ToolIO[T]["create"] | FormData) =>
    api.post<Created<T>>(`/api/tools/${tool}/drafts`, body),

  save: <T extends ToolKey>(id: number, output: ToolIO[T]["output"]) =>
    api.put<{ draft: Draft<T> }>(`/api/drafts/${id}`, { output }).then((r) => r.draft),

  approve: <T extends ToolKey>(id: number) =>
    api.post<{ draft: Draft<T> }>(`/api/drafts/${id}/approve`).then((r) => r.draft),

  retry: <T extends ToolKey>(id: number) =>
    api.post<{ draft: Draft<T> }>(`/api/drafts/${id}/retry`).then((r) => r.draft),

  remove: (id: number) => api.del<{ ok: true }>(`/api/drafts/${id}`),

  uploadAudio,

  saveNotepad: (id: number, text: string) => api.put<{ ok: true }>(`/api/meetings/${id}/notepad`, { text }),

  askMeeting: (id: number, question: string) =>
    api.post<{ answer: string; refs: number[] }>(`/api/meetings/${id}/ask`, { question }),
};

/* ---------- Recording upload (chunked, resumable) ---------- */

interface ChunkReply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

function postChunk(url: string, form: FormData, onBytes: (n: number) => void): Promise<ChunkReply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onBytes(e.loaded / e.total);
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, "Can't reach your school's server. Check your network connection."));
    xhr.send(form);
  });
}

/**
 * Send a recording to POST /api/meetings/{id}/audio in chunks of `chunkBytes`. A chunk the server
 * already has (409 with `received`) is skipped; a dropped connection is retried a few times.
 * Resolves with the draft once the last chunk has queued transcription. A "call" track never
 * queues anything: upload it first, then the microphone.
 */
async function uploadAudio(
  id: number,
  audio: Blob,
  opts: { filename?: string; chunkBytes?: number; onProgress?: (fraction: number) => void; track?: AudioTrack } = {},
): Promise<Draft<"meeting">> {
  const size = audio.size;
  const chunk = Math.max(256 * 1024, opts.chunkBytes ?? 8 * 1024 * 1024);
  const url = `/api/meetings/${id}/audio${opts.track ? `?track=${opts.track}` : ""}`;
  let offset = 0;
  let failures = 0;
  for (;;) {
    const end = Math.min(size, offset + chunk);
    const final = end >= size;
    const form = new FormData();
    form.append("offset", String(offset));
    form.append("final", String(final));
    form.append("consent", "true");
    form.append("file", audio.slice(offset, end), opts.filename ?? "meeting.webm");
    const base = offset;
    let reply: ChunkReply;
    try {
      reply = await postChunk(url, form, (f) => opts.onProgress?.(size ? (base + f * (end - base)) / size : 1));
    } catch (e) {
      if (++failures > 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * failures));
      continue;
    }
    if (reply.status === 409 && typeof reply.body?.received === "number" && failures++ < 3) {
      offset = reply.body.received; // resume where the server left off
      continue;
    }
    if (reply.status < 200 || reply.status >= 300) {
      throw new ApiError(reply.status, reply.body?.error || "The recording didn't upload. Try again.");
    }
    failures = 0;
    offset = reply.body.received ?? end;
    opts.onProgress?.(size ? offset / size : 1);
    if (final || offset >= size) return reply.body.draft as Draft<"meeting">;
  }
}

/* ---------- Helpers ---------- */

/** Multipart body from plain fields (skips empty values) plus files under `field`. */
export function toForm(fields: Record<string, unknown>, files: File[] = [], field = "files"): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  for (const f of files) fd.append(field, f, f.name);
  return fd;
}

export const isWorking = (s: DraftStatus | undefined) => s === "queued" || s === "running";

const WRITING: Record<ToolKey, string> = {
  meeting: "Writing notes…",
  feedback: "Writing feedback…",
  adapt: "Adapting…",
  email: "Writing…",
};

/** The one teacher-facing line for a draft's state. */
export function statusWord(d: Pick<DraftSummary, "tool" | "status" | "stage">): string {
  if (d.status === "awaiting_audio") return "Uploading…";
  if (d.status === "queued" || d.stage === "waiting") return "Waiting your turn…";
  if (d.status === "running") return d.stage === "transcribing" ? "Transcribing…" : WRITING[d.tool];
  if (d.status === "error") return "Didn't work";
  return "Ready";
}

export const LANGUAGES = [
  "English",
  "Spanish",
  "Chinese",
  "Vietnamese",
  "Arabic",
  "Haitian Creole",
  "Portuguese",
  "French",
  "Russian",
  "Korean",
  "Tagalog",
  "Somali",
  "Ukrainian",
  "Hindi",
  "Urdu",
  "Bengali",
  "Japanese",
  "Polish",
];

export const TOOL_PATHS: Record<ToolKey, string> = {
  meeting: "/tools/meeting",
  feedback: "/tools/feedback",
  adapt: "/tools/adapt",
  email: "/tools/email",
};
