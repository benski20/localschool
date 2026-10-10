import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRow } from "../../lib/types";

/**
 * Upload files to POST /api/documents one request per file (so each has its own
 * progress), then poll GET /api/documents until each document is ready.
 *
 * Shared by Ask (private attachments) and Documents (school uploads).
 *
 *   const up = useUpload({ visibility: "private" });
 *   up.add(fileList);                 // starts uploading immediately
 *   up.items                          // UploadItem[] in the order added
 *   up.remove(item.key)               // aborts if still uploading; never deletes on the server
 *   up.retry(item.key)                // re-uploads a failed file
 *   up.readyIds                       // document ids that are ready
 */

export type UploadState = "uploading" | "processing" | "ready" | "error";

export interface UploadItem {
  /** Stable client-side key (use for React keys and remove/retry). */
  key: string;
  name: string;
  size: number;
  /** 0–1. Upload bytes drive 0–0.9; processing holds at 0.95; ready is 1. */
  progress: number;
  state: UploadState;
  /** Server document id once the upload is accepted. */
  docId: number | null;
  /** Teacher-readable reason when state is "error". */
  error: string;
}

export interface UseUploadOptions {
  /** Sent as the "visibility" form field. Default "school". */
  visibility?: "school" | "private";
  /** Called once per item when it becomes ready. */
  onReady?: (item: UploadItem) => void;
  /** Called once per item when it fails. */
  onError?: (item: UploadItem) => void;
  /** Poll interval while any document is processing. Default 1500ms. */
  pollMs?: number;
}

export interface UseUpload {
  items: UploadItem[];
  add: (files: FileList | Iterable<File> | null | undefined) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  /** Remove every item (aborting any upload in flight). */
  clear: () => void;
  /** True while anything is uploading or processing. */
  busy: boolean;
  readyIds: number[];
}

/** File types the server can read. Use as an <input accept>. */
export const UPLOAD_ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const EXTENSIONS = UPLOAD_ACCEPT.split(",");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A friendly reason a file can't be uploaded, or "" if it's fine. */
export function rejectReason(file: File): string {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  if (!EXTENSIONS.includes(ext)) return "Use a PDF, Word, Markdown or text file.";
  if (file.size > MAX_UPLOAD_BYTES) return "This file is larger than 25 MB.";
  if (file.size === 0) return "This file is empty.";
  return "";
}

let seq = 0;

export function useUpload(opts: UseUploadOptions = {}): UseUpload {
  const { visibility = "school", pollMs = 1500 } = opts;
  const [items, setItems] = useState<UploadItem[]>([]);
  const files = useRef(new Map<string, File>());
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const cb = useRef(opts);
  cb.current = opts;
  // Fire onReady / onError exactly once per transition.
  const announced = useRef(new Map<string, UploadState>());

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  }, []);

  const send = useCallback(
    (key: string) => {
      const file = files.current.get(key);
      if (!file) return;
      const bad = rejectReason(file);
      if (bad) {
        patch(key, { state: "error", error: bad, progress: 0 });
        return;
      }
      const form = new FormData();
      form.append("files", file, file.name);
      form.append("visibility", visibility);
      const xhr = new XMLHttpRequest();
      xhrs.current.set(key, xhr);
      xhr.open("POST", "/api/documents");
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patch(key, { progress: Math.min(0.9, (e.loaded / e.total) * 0.9) });
      };
      xhr.onerror = () => {
        xhrs.current.delete(key);
        patch(key, { state: "error", error: "Couldn't reach the server. Try again.", progress: 0 });
      };
      xhr.onload = () => {
        xhrs.current.delete(key);
        let data: { created?: number[]; errors?: { error: string }[]; error?: string } | null = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* handled below */
        }
        const id = data?.created?.[0];
        if (xhr.status >= 200 && xhr.status < 300 && typeof id === "number") {
          patch(key, { state: "processing", docId: id, progress: 0.95 });
        } else {
          const msg = data?.errors?.[0]?.error || data?.error || "Couldn't read this file.";
          patch(key, { state: "error", error: msg, progress: 0 });
        }
      };
      patch(key, { state: "uploading", progress: 0.02, error: "", docId: null });
      xhr.send(form);
    },
    [patch, visibility],
  );

  const add = useCallback(
    (list: FileList | Iterable<File> | null | undefined) => {
      if (!list) return;
      const arr = Array.from(list as Iterable<File>);
      if (!arr.length) return;
      const fresh: UploadItem[] = arr.map((f) => {
        const key = `up-${Date.now().toString(36)}-${++seq}`;
        files.current.set(key, f);
        return { key, name: f.name, size: f.size, progress: 0, state: "uploading", docId: null, error: "" };
      });
      setItems((xs) => [...xs, ...fresh]);
      // Start after the chips render so their entrance and the bar animate.
      requestAnimationFrame(() => fresh.forEach((it) => send(it.key)));
    },
    [send],
  );

  const remove = useCallback((key: string) => {
    xhrs.current.get(key)?.abort();
    xhrs.current.delete(key);
    files.current.delete(key);
    announced.current.delete(key);
    setItems((xs) => xs.filter((x) => x.key !== key));
  }, []);

  const clear = useCallback(() => {
    xhrs.current.forEach((x) => x.abort());
    xhrs.current.clear();
    files.current.clear();
    announced.current.clear();
    setItems([]);
  }, []);

  const retry = useCallback((key: string) => send(key), [send]);

  // Poll while anything is processing.
  const processing = items.some((x) => x.state === "processing");
  useEffect(() => {
    if (!processing) return;
    let live = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/documents", { credentials: "same-origin" });
        if (!res.ok || !live) return;
        const data = (await res.json()) as { documents: DocumentRow[] };
        const byId = new Map(data.documents.map((d) => [d.id, d]));
        setItems((xs) =>
          xs.map((x) => {
            if (x.state !== "processing" || x.docId === null) return x;
            const d = byId.get(x.docId);
            if (!d) return x;
            if (d.status === "ready") return { ...x, state: "ready", progress: 1 };
            if (d.status === "error") return { ...x, state: "error", progress: 0, error: d.error || "Couldn't read this file." };
            return x;
          }),
        );
      } catch {
        /* try again next tick */
      }
    };
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [processing, pollMs]);

  // Announce transitions.
  useEffect(() => {
    for (const it of items) {
      const prev = announced.current.get(it.key);
      if (prev === it.state) continue;
      announced.current.set(it.key, it.state);
      if (it.state === "ready") cb.current.onReady?.(it);
      if (it.state === "error") cb.current.onError?.(it);
    }
  }, [items]);

  useEffect(() => {
    const live = xhrs.current;
    return () => live.forEach((x) => x.abort());
  }, []);

  return {
    items,
    add,
    remove,
    retry,
    clear,
    busy: items.some((x) => x.state === "uploading" || x.state === "processing"),
    readyIds: items.filter((x) => x.state === "ready" && x.docId !== null).map((x) => x.docId as number),
  };
}
