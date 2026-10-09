import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Download, Search, Upload, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Section, Student } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Badge, EmptyState, PageHeader, Skeleton, Spinner } from "../components/ui";

interface Preview {
  students: number;
  sections: { name: string; period: string }[];
  errors: string[];
  warnings: string[];
  preview: Record<string, string>[];
}

export function Roster() {
  const { user } = useAuth();
  const toast = useToast();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [filter, setFilter] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ file: File; data: Preview } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === "admin";

  const load = useCallback(() => {
    api
      .get<{ sections: Section[]; students: Student[] }>("/api/roster")
      .then((r) => {
        setSections(r.sections);
        setStudents(r.students);
      })
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter(
      (s) =>
        (filter === "all" || s.section_id === filter) &&
        (!q || s.name.toLowerCase().includes(q) || s.accommodations.some((a) => a.toLowerCase().includes(q))),
    );
  }, [students, filter, query]);

  async function choose(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      setPreview({ file, data: await api.post<Preview>("/api/roster/preview", fd) });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirmImport() {
    if (!preview) return;
    const fd = new FormData();
    fd.append("file", preview.file);
    setImporting(true);
    try {
      const r = await api.post<{ students: number; sections: number; unmatched_teachers: string[] }>("/api/roster/import", fd);
      toast({ kind: "success", message: `Imported ${r.students} students in ${r.sections} sections.` });
      if (r.unmatched_teachers.length)
        toast({ kind: "info", message: `No account yet for ${r.unmatched_teachers.join(", ")}. Their sections link automatically once you add them.` });
      setPreview(null);
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 py-8 md:px-8 md:py-10">
      <PageHeader
        title="Roster"
        description={
          isAdmin
            ? "Every section and student. Teachers see only the sections they teach, and the assistant follows the same rule."
            : "Your sections and students. The assistant uses this to answer questions about your classes. Only you and admins can see it."
        }
        actions={
          isAdmin && (
            <>
              <a className="btn-ghost" href="/api/roster/template.csv">
                <Download className="h-4 w-4" /> Template
              </a>
              <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Import CSV
              </button>
              <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
            </>
          )
        }
      />

      {sections === null ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : sections.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={isAdmin ? "No roster yet" : "No sections assigned to you"}
            body={isAdmin ? "Import a CSV with one row per student per section. Download the template to see the columns." : "Ask your administrator to import the roster with your email as the teacher."}
            action={
              isAdmin && (
                <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                  <Upload className="h-4 w-4" /> Import CSV
                </button>
              )
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1" role="tablist" aria-label="Sections">
              {[{ id: "all" as const, label: "All", count: students.length }, ...sections.map((s) => ({ id: s.id, label: `${s.name}${s.period ? ` · P${s.period}` : ""}`, count: s.student_count }))].map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={filter === t.id}
                  onClick={() => setFilter(t.id)}
                  className={clsx(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                    filter === t.id ? "bg-subtle font-medium text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                  <span className="tabular-nums text-xs text-faint">{t.count}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" aria-hidden />
              <input className="input h-9 pl-8" placeholder="Search names or accommodations" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search roster" />
            </div>
          </div>

          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Student", "Section", "Plan", "Accommodations", "Plan review", "Reading", "English learner"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium text-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((s) => {
                  const due = s.iep_review_date && s.iep_review_date >= today && s.iep_review_date <= soon;
                  return (
                    <tr key={s.id} className="align-top transition-colors hover:bg-subtle/60">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{s.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {s.section_name}
                        {s.period && <span className="text-faint"> · P{s.period}</span>}
                      </td>
                      <td className="px-4 py-3">{s.plan_type ? <Badge tone="accent">{s.plan_type}</Badge> : <span className="text-faint">—</span>}</td>
                      <td className="px-4 py-3">
                        {s.accommodations.length ? (
                          <div className="flex max-w-[340px] flex-wrap gap-1">
                            {s.accommodations.map((a) => (
                              <Badge key={a}>{a}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        {s.iep_review_date ? (
                          <span className={due ? "font-medium text-warning" : "text-muted"}>
                            {formatDate(s.iep_review_date)}
                            {due && <span className="ml-1.5 text-xs font-normal">within 30 days</span>}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{s.reading_level || <span className="text-faint">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {s.el_level || <span className="text-faint">—</span>}
                        {s.home_language && s.home_language !== "English" && <div className="text-xs text-faint">{s.home_language}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-faint">No students match.</p>}
          </div>
        </>
      )}

      <Dialog.Root open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 animate-fadein" />
          <Dialog.Content className="fixed left-1/2 top-[10vh] z-50 w-[720px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl bg-panel p-6 shadow-pop animate-fadein">
            <Dialog.Title className="text-lg text-ink">Review roster import</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              {preview?.file.name}. Importing <span className="font-medium text-ink">replaces</span> the current roster.
            </Dialog.Description>
            {preview && (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Students" value={preview.data.students} />
                  <Stat label="Sections" value={preview.data.sections.length} />
                </div>
                {preview.data.errors.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-danger/25 bg-danger/[0.04] px-4 py-3 text-sm text-danger">
                    {preview.data.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
                {preview.data.warnings.length > 0 && (
                  <ul className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-warning/25 bg-warning/[0.05] px-4 py-3 text-sm text-warning">
                    {preview.data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {preview.data.preview.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-line text-left text-faint">
                          <th className="px-3 py-2 font-medium">Student</th>
                          <th className="px-3 py-2 font-medium">Section</th>
                          <th className="px-3 py-2 font-medium">Teacher</th>
                          <th className="px-3 py-2 font-medium">Accommodations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {preview.data.preview.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-ink">{r.student_name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted">
                              {r.section}
                              {r.period && ` · P${r.period}`}
                            </td>
                            <td className="px-3 py-2 text-muted">{r.teacher_email || "—"}</td>
                            <td className="px-3 py-2 text-muted">{r.accommodations || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Dialog.Close className="btn-secondary">Cancel</Dialog.Close>
                  <button className="btn-primary" disabled={importing || preview.data.errors.length > 0} onClick={confirmImport}>
                    {importing && <Spinner />} Replace roster
                  </button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
