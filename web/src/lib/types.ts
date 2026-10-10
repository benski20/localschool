export type Role = "admin" | "teacher";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Source {
  n: number;
  /** "attachment" = the teacher's own private file attached to the question (UI: "Your file"). */
  kind: "document" | "student" | "attachment";
  title: string;
  subtitle: string;
  text: string;
  document_id: number | null;
  chunk_id: number | null;
  page: number | null;
  student_id: number | null;
}

export interface Message {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  model?: string;
  created_at?: string;
  pending?: boolean;
  error?: string;
  notice?: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  updated_at: string;
}

export type ChatEvent =
  | { type: "conversation"; id: number }
  | { type: "sources"; sources: Source[] }
  | { type: "queued"; position: number }
  | { type: "status"; status: string; message: string }
  | { type: "token"; text: string }
  | { type: "done"; message_id: number; content: string; sources: Source[]; model: string }
  | { type: "error"; message: string };

export interface Status {
  school: string;
  runtime: { kind: string; is_local: boolean; state: "connected" | "idle" | "unreachable"; last_ok: number | null; error: string };
  models: { chat: string; embed: string };
  index: { model: string; total_chunks: number; embedded_chunks: number; ready: boolean; syncing: boolean; error: string };
  queue: { waiting: number };
}

export interface DocumentRow {
  id: number;
  title: string;
  filename: string;
  mime: string;
  size: number;
  status: string;
  error: string;
  pages: number;
  created_at: string;
  owner_name: string | null;
  owner_id: number | null;
  chunk_count: number;
  embedded_count: number;
}

export interface Section {
  id: number;
  name: string;
  period: string;
  teacher_email: string;
  teacher_name: string | null;
  student_count: number;
}

export interface Student {
  id: number;
  name: string;
  grade: string;
  section_id: number;
  section_name: string;
  period: string;
  reading_level: string;
  el_level: string;
  home_language: string;
  plan_type: string;
  iep_review_date: string;
  case_manager: string;
  accommodations: string[];
}

export interface ModelInfo {
  name: string;
  size_bytes: number | null;
  parameter_size: string;
  quantization: string;
  family: string;
  loaded: boolean;
}

export interface Preset {
  name: string;
  label: string;
  note: string;
}

export interface PullState {
  model: string;
  status: string;
  completed: number | null;
  total: number | null;
  done: boolean;
  error: string;
  percent: number | null;
}

export interface RuntimeConfigPublic {
  kind: string;
  url: string;
  token: string;
  headers: string;
  has_token: boolean;
  is_local: boolean;
}

export interface RuntimeHealth {
  ok: boolean;
  latency_ms: number | null;
  version: string;
  loaded_models: string[];
  vram_bytes: number | null;
  error: string;
}
