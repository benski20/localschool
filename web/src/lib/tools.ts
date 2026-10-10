/**
 * Tools API client: every request and response type for the four tools lives here, so the shapes
 * can be adjusted in one place once the server lands (see scratchpad/design/TOOLS.md).
 *
 *   POST   /api/tools/{tool}/drafts      json or multipart → { draft } (feedback batches may return { drafts })
 *   GET    /api/tools/{tool}/drafts      → { drafts: DraftSummary[] }
 *   GET    /api/drafts/{id}              → { draft }   (poll while queued/running)
 *   PUT    /api/drafts/{id}              { output } → { draft }
 *   POST   /api/drafts/{id}/approve      → { draft }   (meeting: deletes the audio)
 *   DELETE /api/drafts/{id}
 *   POST   /api/meetings/{id}/audio      multipart "file" → { draft } (starts transcription)
 *
 * Responses go through normalizeDraft(), which accepts either `input`/`output` or the raw
 * `input_json`/`output_json` column names, and progress as 0–1 or 0–100.
 */
import { api } from "./api";

export type ToolKey = "meeting" | "feedback" | "adapt" | "email";
export type DraftStatus = "queued" | "running" | "ready" | "error";

/* ---------- Meeting notes ---------- */

export type MeetingType = "iep" | "parent" | "sst" | "plc" | "other";

export interface MeetingInput {
  meeting_type: MeetingType;
  student_id?: number | null;
  /** Set when the teacher pasted a transcript instead of recording. */
  transcript?: string;
}

/** One line of the transcript. `start`/`end` are seconds from the start of the recording. */
export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

/** A note item. `refs` are indexes into the transcript segments ("show the receipts"). */
export interface NoteItem {
  text: string;
  refs?: number[];
}

export interface ActionItem {
  task: string;
  owner: string;
  due?: string | null;
  refs?: number[];
}

/**
 * Notes per meeting type. Every type has a summary; the lists present depend on the type
 * (IEP: decisions, services_discussed, action_items; parent conference: concerns, action_items…).
 * Unknown list keys of NoteItem[] are rendered too, titled from the key.
 */
export interface MeetingNotes {
  summary: string;
  summary_refs?: number[];
  decisions?: NoteItem[];
  services_discussed?: NoteItem[];
  concerns?: NoteItem[];
  action_items?: ActionItem[];
  [section: string]: unknown;
}

/* ---------- Feedback ---------- */

export interface FeedbackInput {
  /** Pasted work. Uploaded files go as multipart "files" instead. */
  text?: string;
  rubric_document_id?: number | null;
  rubric_text?: string;
  focus?: string;
  student_id?: number | null;
}

export interface FeedbackPoint {
  text: string;
  /** Passage quoted from the student's work. */
  quote: string;
  /** The rubric line this maps to. */
  rubric: string;
}

export interface FeedbackOutput {
  strengths: FeedbackPoint[];
  next_steps: FeedbackPoint[];
}

/* ---------- Adapt a reading ---------- */

export type AdaptMode = "level" | "student" | "translate";

export interface AdaptInput {
  text?: string;
  mode: AdaptMode;
  /** "2".."12" when mode = level. */
  grade?: string;
  student_id?: number | null;
  /** Target language name when mode = translate, e.g. "Spanish". */
  language?: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface AdaptOutput {
  /** The source text as the server read it (useful for uploads). Falls back to input.text. */
  original?: string;
  adapted: string;
  glossary: GlossaryEntry[];
}

/* ---------- Parent email ---------- */

export type Tone = "warm" | "neutral" | "firm";

export interface EmailInput {
  student_id: number;
  topic: string;
  tone: Tone;
  language: string;
}

export interface EmailOutput {
  subject: string;
  body: string;
}

/* ---------- Drafts ---------- */

export interface ToolIO {
  meeting: { input: MeetingInput; output: MeetingNotes };
  feedback: { input: FeedbackInput; output: FeedbackOutput };
  adapt: { input: AdaptInput; output: AdaptOutput };
  email: { input: EmailInput; output: EmailOutput };
}

export interface DraftSummary {
  id: number;
  tool: ToolKey;
  title: string;
  status: DraftStatus;
  created_at: string;
  updated_at?: string;
}

export interface Draft<T extends ToolKey = ToolKey> extends DraftSummary {
  tool: T;
  input: ToolIO[T]["input"];
  output: ToolIO[T]["output"] | null;
  /** 0–100, or null when unknown. */
  progress: number | null;
  error: string;
  student_id: number | null;
  /* Meeting only */
  transcript?: Segment[];
  has_audio?: boolean;
  approved_at?: string | null;
  /** Feedback only: the uploaded file's name, when the piece came from a file. */
  filename?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

export function normalizeDraft<T extends ToolKey = ToolKey>(r: Raw): Draft<T> {
  let progress: number | null = typeof r.progress === "number" ? r.progress : null;
  if (progress !== null && progress <= 1 && r.status !== "ready") progress *= 100;
  if (r.status === "ready") progress = 100;
  const transcript = r.transcript ?? r.transcript_json ?? undefined;
  return {
    id: r.id,
    tool: r.tool,
    title: r.title ?? "",
    status: r.status ?? "queued",
    created_at: r.created_at ?? new Date().toISOString(),
    updated_at: r.updated_at,
    input: r.input ?? r.input_json ?? {},
    output: r.output ?? r.output_json ?? null,
    progress,
    error: r.error ?? "",
    student_id: r.student_id ?? null,
    transcript: Array.isArray(transcript) ? transcript : transcript?.segments,
    has_audio: r.has_audio ?? (r.audio_path !== undefined ? !!r.audio_path : undefined),
    approved_at: r.approved_at ?? null,
    filename: r.filename ?? r.input?.filename ?? r.input_json?.filename,
  };
}

const one = <T extends ToolKey>(r: Raw) => normalizeDraft<T>(r.draft ?? r);

export const tools = {
  list: (tool: ToolKey) =>
    api.get<{ drafts: DraftSummary[] }>(`/api/tools/${tool}/drafts`).then((r) => r.drafts ?? []),

  get: <T extends ToolKey>(id: number) => api.get<Raw>(`/api/drafts/${id}`).then((r) => one<T>(r)),

  /** JSON body, or FormData for uploads. Always resolves to a list (a feedback batch makes several). */
  create: <T extends ToolKey>(tool: T, body: ToolIO[T]["input"] | FormData) =>
    api.post<Raw>(`/api/tools/${tool}/drafts`, body).then((r) => {
      const list: Raw[] = Array.isArray(r.drafts) ? r.drafts : [r.draft ?? r];
      return list.map((d) => normalizeDraft<T>(d));
    }),

  save: <T extends ToolKey>(id: number, output: ToolIO[T]["output"]) =>
    api.put<Raw>(`/api/drafts/${id}`, { output }).then((r) => one<T>(r)),

  approve: (id: number) => api.post<Raw>(`/api/drafts/${id}/approve`).then((r) => one<"meeting">(r)),

  remove: (id: number) => api.del<unknown>(`/api/drafts/${id}`),

  uploadAudio: (id: number, audio: Blob, filename = "meeting.webm") => {
    const fd = new FormData();
    fd.append("file", audio, filename);
    return api.post<Raw>(`/api/meetings/${id}/audio`, fd).then((r) => one<"meeting">(r));
  },
};

/** Build multipart form data from an input object plus files (arrays/objects as JSON strings). */
export function toForm(input: object, files: File[] = [], field = "files"): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  for (const f of files) fd.append(field, f, f.name);
  return fd;
}

export const isWorking = (s: DraftStatus | undefined) => s === "queued" || s === "running";

/* ---------- Labels shown to teachers ---------- */

export const MEETING_TYPES: { value: MeetingType; label: string }[] = [
  { value: "iep", label: "IEP meeting" },
  { value: "parent", label: "Parent conference" },
  { value: "sst", label: "Student support team" },
  { value: "plc", label: "Team / PLC" },
  { value: "other", label: "Other" },
];

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

export const GRADES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export const TOOL_PATHS: Record<ToolKey, string> = {
  meeting: "/tools/meeting",
  feedback: "/tools/feedback",
  adapt: "/tools/adapt",
  email: "/tools/email",
};
