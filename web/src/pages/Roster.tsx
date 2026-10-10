import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Download, SearchX, Upload, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Section, Student } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton, Spinner } from "../components/ui";
import {
  Callout,
  Chip,
  DetailList,
  Figure,
  Label,
  Modal,
  ModalFooter,
  Monogram,
  SearchField,
  Segmented,
  Sheet,
  StatusText,
  Tabs,
  WorkspaceHeader,
  WorkspacePage,
  dangerButton,
  linkClass,
  useKeyShortcut,
} from "../components/workspace/primitives";

interface Preview {
  students: number;
  sections: { name: string; period: string }[];
  errors: string[];
  warnings: string[];
  preview: Record<string, string>[];
}

type PlanFilter = "all" | "IEP" | "504" | "EL" | "review";

const DAY = 86400000;

export function Roster() {
  const { user } = useAuth();
  const toast = useToast();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [filter, setFilter] = useState<number | "all">("all");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ file: File; data: Preview } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
  const isDue = useCallback((s: Student) => !!s.iep_review_date && s.iep_review_date >= today && s.iep_review_date <= soon, [today, soon]);

  const inSection = useMemo(() => students.filter((s) => filter === "all" || s.section_id === filter), [students, filter]);

  const planCounts = useMemo(
    () => ({
      all: inSection.length,
      IEP: inSection.filter((s) => s.plan_type === "IEP").length,
      "504": inSection.filter((s) => s.plan_type === "504").length,
      EL: inSection.filter((s) => !!s.el_level).length,
      review: inSection.filter(isDue).length,
    }),
    [inSection, isDue],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inSection.filter(
      (s) =>
        (plan === "all" || (plan === "EL" ? !!s.el_level : plan === "review" ? isDue(s) : s.plan_type === plan)) &&
        (!q || s.name.toLowerCase().includes(q) || s.accommodations.some((a) => a.toLowerCase().includes(q))),
    );
  }, [inSection, plan, query, isDue]);

  async function choose(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setChecking(file.name);
    try {
      setPreview({ file, data: await api.post<Preview>("/api/roster/preview", fd) });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setChecking(null);
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

  useKeyShortcut("/", useCallback(() => searchRef.current?.focus(), []));

  const openIdx = visible.findIndex((s) => s.id === openId);
  const openStudent = openIdx >= 0 ? visible[openIdx] : students.find((s) => s.id === openId) ?? null;
  const step = useCallback(
    (d: 1 | -1) => {
      if (!visible.length) return;
      const i = openIdx < 0 ? 0 : (openIdx + d + visible.length) % visible.length;
      setOpenId(visible[i].id);
    },
    [visible, openIdx],
  );

  const totals = useMemo(
    () => ({
      plans: inSection.filter((s) => s.plan_type).length,
      el: inSection.filter((s) => s.el_level).length,
      due: inSection.filter(isDue).length,
    }),
    [inSection, isDue],
  );
  const clear = () => {
    setQuery("");
    setPlan("all");
  };

  return (
    <WorkspacePage width={1240}>
      <WorkspaceHeader
        title="Roster"
        description={isAdmin ? "Every section and student. Teachers see only the sections they teach." : "Your sections and students. Only you and admins can see them."}
        actions={
          isAdmin && (
            <>
              <a className="btn-secondary" href="/api/roster/template.csv">
                <Download className="h-4 w-4" aria-hidden /> Template
              </a>
              <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={!!checking}>
                {checking ? <Spinner /> : <Upload className="h-4 w-4" aria-hidden />} Import CSV
              </button>
              <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
            </>
          )
        }
      />

      {sections === null ? (
        <div className="mt-8 border border-line bg-panel">
          <div className="flex gap-6 border-b border-line px-6 pb-3 pt-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-4 w-20 rounded-[2px]" />
            ))}
          </div>
          <div className="divide-y divide-line">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-3">
                <Skeleton className="h-7 w-7 rounded-[2px]" />
                <Skeleton className="h-3.5 w-40 rounded-[2px]" />
                <Skeleton className="ml-auto hidden h-5 w-48 rounded-[2px] sm:block" />
              </div>
            ))}
          </div>
        </div>
      ) : sections.length === 0 ? (
        <EmptyRoster isAdmin={isAdmin} onImport={() => fileInput.current?.click()} />
      ) : (
        <div className="ws-rise mt-8 border border-line bg-panel" style={{ animationDelay: "40ms" }}>
          {/* Sections */}
          <div className="border-b border-line px-5 pt-5 sm:px-6">
            <Label className="mb-2">Sections</Label>
            <Tabs
              label="Sections"
              value={filter}
              onChange={setFilter}
              items={[
                { id: "all" as const, label: "All", count: students.length },
                ...sections.map((s) => ({
                  id: s.id,
                  label: (
                    <span>
                      {s.name}
                      {s.period && <span className="text-faint"> · P{s.period}</span>}
                      {isAdmin && s.teacher_name && <span className="hidden text-faint lg:inline"> · {s.teacher_name}</span>}
                    </span>
                  ),
                  count: s.student_count,
                })),
              ]}
            />
          </div>

          {/* Summary */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line px-5 py-5 sm:grid-cols-4 sm:px-6">
            <Figure label="Students" value={inSection.length} />
            <Figure label="IEP or 504" value={totals.plans} />
            <Figure label="English learners" value={totals.el} />
            <Figure label="Reviews in 30 days" value={totals.due} tone={totals.due ? "warning" : undefined} />
          </dl>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-line px-5 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              className="self-start"
              label="Filter by plan"
              value={plan}
              onChange={setPlan}
              items={[
                { id: "all", label: "Everyone", count: planCounts.all },
                { id: "IEP", label: "IEP", count: planCounts.IEP },
                { id: "504", label: "504", count: planCounts["504"] },
                { id: "EL", label: "EL", count: planCounts.EL },
                { id: "review", label: "Review soon", count: planCounts.review },
              ]}
            />
            <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search names or accommodations" label="Search roster" className="w-full lg:w-72" />
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="overflow-x-auto xl:overflow-visible">
              <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left">
                    {[
                      ["Student", "pl-6"],
                      ["Section", ""],
                      ["Plan", ""],
                      ["Accommodations", ""],
                      ["Plan review", ""],
                      ["Reading", ""],
                      ["English learner", "pr-6"],
                    ].map(([h, c]) => (
                      <th key={h} scope="col" className={clsx("sticky top-0 z-10 whitespace-nowrap border-b border-line bg-panel px-3 py-2.5 text-xs font-normal text-faint", c)}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="ws-stagger">
                  {visible.map((s, i) => (
                    <StudentRow key={s.id} s={s} i={i} due={isDue(s)} today={today} selected={s.id === openId} onOpen={() => setOpenId(s.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length === 0 && <NoMatch onClear={clear} />}
          </div>

          {/* Phone list */}
          <ul className="ws-stagger divide-y divide-line md:hidden">
            {visible.map((s, i) => (
              <li key={s.id} style={{ ["--i" as string]: i }}>
                <button data-student-row className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors active:bg-bg" onClick={() => setOpenId(s.id)}>
                  <Monogram name={s.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-ink">{s.name}</span>
                      {isDue(s) && <StatusText tone="warning">Review {formatDate(s.iep_review_date, true)}</StatusText>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-faint">
                      {s.section_name}
                      {s.period && ` · P${s.period}`}
                      {s.reading_level && ` · Reading ${s.reading_level}`}
                    </span>
                    {(s.plan_type || s.el_level || s.accommodations.length > 0) && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        <PlanChips s={s} withEl />
                        <AccommodationChips list={s.accommodations} max={2} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li>
                <NoMatch onClear={clear} />
              </li>
            )}
          </ul>
          <div className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6">
            <span className="font-mono">{visible.length}</span> of <span className="font-mono">{inSection.length}</span> students
            <span className="hidden md:inline">
              {" "}· Select a row for details · <span className="kbd">J</span> <span className="kbd">K</span> move between students
            </span>
          </div>
        </div>
      )}

      <StudentSheet student={openStudent} today={today} due={openStudent ? isDue(openStudent) : false} onClose={() => setOpenId(null)} onStep={step} position={openIdx >= 0 ? [openIdx + 1, visible.length] : null} />

      <Modal
        open={!!preview || !!checking}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
        width={760}
        label="Roster import"
        title="Review before replacing"
        description={
          <>
            <span className="font-mono text-[12px] text-ink">{preview?.file.name ?? checking}</span>
            <span className="text-faint"> · </span>
            Importing <span className="font-medium text-ink">replaces</span> the current roster.
          </>
        }
      >
        {!preview ? (
          <div className="space-y-4 px-6 pb-6 pt-4" aria-busy>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5" /> Checking the file…
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-[2px]" />
              ))}
            </div>
            <Skeleton className="h-40 w-full rounded-[2px]" />
          </div>
        ) : (
          <>
            <div className="space-y-5 px-6 pb-6 pt-4">
              <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
                <Figure label="Students" value={preview.data.students} />
                <Figure label="Sections" value={preview.data.sections.length} />
                <Figure label="Warnings" value={preview.data.warnings.length} tone={preview.data.warnings.length ? "warning" : undefined} />
                <Figure label="Errors" value={preview.data.errors.length} tone={preview.data.errors.length ? "danger" : undefined} />
              </dl>
              {preview.data.errors.length > 0 && (
                <Callout tone="danger" icon={<AlertCircle className="h-4 w-4" />} title="Fix these before importing">
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {preview.data.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Callout>
              )}
              {preview.data.warnings.length > 0 && (
                <Callout tone="warning" icon={<AlertTriangle className="h-4 w-4" />} title="Worth a look">
                  <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                    {preview.data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Callout>
              )}
              {preview.data.sections.length > 0 && (
                <div>
                  <Label className="mb-2">Sections in this file</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.data.sections.map((s) => (
                      <Chip key={`${s.name}-${s.period}`}>
                        {s.name}
                        {s.period && <span className="text-faint">· P{s.period}</span>}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {preview.data.preview.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label>First rows</Label>
                    <span className="text-xs text-faint">
                      <span className="font-mono">{preview.data.preview.length}</span> of <span className="font-mono">{preview.data.students}</span>
                    </span>
                  </div>
                  <div className="max-h-[240px] overflow-auto border border-line">
                    <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr className="text-left text-faint">
                          {["Student", "Section", "Teacher", "Accommodations"].map((h) => (
                            <th key={h} className="sticky top-0 border-b border-line bg-panel px-3 py-2 font-normal">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.data.preview.map((r, i) => (
                          <tr key={i} className="[&>td]:border-b [&>td]:border-line [&:last-child>td]:border-b-0">
                            <td className="whitespace-nowrap px-3 py-2 text-ink">{r.student_name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted">
                              {r.section}
                              {r.period && ` · P${r.period}`}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted">{r.teacher_email || "—"}</td>
                            <td className="px-3 py-2 text-muted">{r.accommodations || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <ModalFooter hint="Teacher accounts stay. Sections relink by email.">
              <button className="btn-secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button className={dangerButton} disabled={importing || preview.data.errors.length > 0} onClick={confirmImport}>
                {importing && <Spinner />} Replace roster
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </WorkspacePage>
  );
}

/* ------------------------------------------------------------------ Pieces */

function PlanChips({ s, withEl }: { s: Student; withEl?: boolean }) {
  return (
    <>
      {s.plan_type && <Chip className="border-line-strong font-medium text-ink">{s.plan_type}</Chip>}
      {withEl && s.el_level && <Chip>EL</Chip>}
    </>
  );
}

function AccommodationChips({ list, max }: { list: string[]; max: number }) {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  return (
    <>
      {shown.map((a) => (
        <Chip key={a} className="max-w-[200px]">
          <span className="truncate">{a}</span>
        </Chip>
      ))}
      {more > 0 && (
        <Chip className="font-mono text-faint" title={list.slice(max).join(", ")}>
          +{more}
        </Chip>
      )}
    </>
  );
}

function daysUntil(iso: string, today: string) {
  return Math.round((parseDate(iso).getTime() - parseDate(today).getTime()) / DAY);
}

function ReviewDate({ iso, due, today }: { iso: string; due: boolean; today: string }) {
  if (!iso) return <span className="text-faint">—</span>;
  if (due) {
    const days = daysUntil(iso, today);
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-ink">{formatDate(iso, true)}</span>
        <StatusText tone="warning">{days === 0 ? "Today" : `${days} days`}</StatusText>
      </span>
    );
  }
  return <span className="font-mono text-[13px] text-muted">{formatDate(iso)}</span>;
}

function StudentRow({ s, i, due, today, selected, onOpen }: { s: Student; i: number; due: boolean; today: string; selected: boolean; onOpen: () => void }) {
  const cell = "border-b border-line px-3 py-3 align-middle";
  return (
    <tr
      data-student-row
      tabIndex={0}
      style={{ ["--i" as string]: i }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={clsx(
        "cursor-pointer outline-none transition-colors duration-100 focus-visible:bg-subtle [&:last-child>td]:border-b-0",
        selected ? "bg-subtle" : "hover:bg-bg",
      )}
    >
      <td className={clsx(cell, "pl-6")}>
        <div className="flex items-center gap-3">
          <Monogram name={s.name} size={26} />
          <div className="min-w-0">
            <div className="truncate text-ink">{s.name}</div>
            {s.grade && <div className="text-xs text-faint">Grade {s.grade}</div>}
          </div>
        </div>
      </td>
      <td className={clsx(cell, "whitespace-nowrap text-muted")}>
        {s.section_name}
        {s.period && <span className="text-faint"> · P{s.period}</span>}
      </td>
      <td className={cell}>{s.plan_type ? <PlanChips s={s} /> : <span className="text-faint">—</span>}</td>
      <td className={cell}>
        {s.accommodations.length ? (
          <div className="flex max-w-[380px] flex-wrap gap-1">
            <AccommodationChips list={s.accommodations} max={2} />
          </div>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className={clsx(cell, "whitespace-nowrap")}>
        <ReviewDate iso={s.iep_review_date} due={due} today={today} />
      </td>
      <td className={clsx(cell, "whitespace-nowrap text-muted")}>{s.reading_level || <span className="text-faint">—</span>}</td>
      <td className={clsx(cell, "whitespace-nowrap pr-6")}>
        {s.el_level ? <span className="text-muted">{s.el_level}</span> : <span className="text-faint">—</span>}
        {s.home_language && s.home_language !== "English" && <div className="text-xs text-faint">{s.home_language}</div>}
      </td>
    </tr>
  );
}

function StudentSheet({
  student,
  today,
  due,
  onClose,
  onStep,
  position,
}: {
  student: Student | null;
  today: string;
  due: boolean;
  onClose: () => void;
  onStep: (d: 1 | -1) => void;
  position: [number, number] | null;
}) {
  const [last, setLast] = useState<Student | null>(student);
  useEffect(() => {
    if (student) setLast(student);
  }, [student]);
  useEffect(() => {
    if (!student) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        onStep(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        onStep(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [student, onStep]);

  const s = student ?? last;
  if (!s) return null;
  const days = s.iep_review_date ? daysUntil(s.iep_review_date, today) : null;

  return (
    <Sheet
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title={s.name}
      description={
        <>
          {s.section_name}
          {s.period && ` · Period ${s.period}`}
          {s.grade && ` · Grade ${s.grade}`}
        </>
      }
      header={
        <div className="mb-4 flex items-center justify-between">
          <Label>Student</Label>
          {position && (
            <div className="flex items-center gap-0.5 text-xs text-faint">
              <span className="mr-2">
                <span className="font-mono">{position[0]}</span> of <span className="font-mono">{position[1]}</span>
              </span>
              <button className="btn-ghost h-7 w-7 px-0" onClick={() => onStep(-1)} aria-label="Previous student (K)">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button className="btn-ghost h-7 w-7 px-0" onClick={() => onStep(1)} aria-label="Next student (J)">
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-8">
        {(s.plan_type || s.el_level) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {s.plan_type && <Chip className="border-line-strong font-medium text-ink">{s.plan_type} plan</Chip>}
            {s.el_level && <Chip>English learner</Chip>}
            {due && <StatusText tone="warning" className="ml-1.5">Review in {days} days</StatusText>}
          </div>
        )}

        <section>
          <Label as="h3" className="mb-3">
            Accommodations
          </Label>
          {s.accommodations.length ? (
            <ol className="divide-y divide-line border-y border-line">
              {s.accommodations.map((a, i) => (
                <li key={a} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 py-2.5 text-sm text-ink">
                  <span className="pt-px font-mono text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                  {a}
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-y border-line py-3 text-sm text-faint">No accommodations on file.</p>
          )}
        </section>

        {s.plan_type && (
          <section>
            <Label as="h3" className="mb-3">
              Plan
            </Label>
            <DetailList
              items={[
                { label: "Type", value: s.plan_type },
                {
                  label: "Next review",
                  value: s.iep_review_date ? (
                    <span>
                      <span className="font-mono text-[13px]">{formatDate(s.iep_review_date)}</span>
                      {days !== null && days >= 0 && <span className={due ? "text-warning" : "text-faint"}> · in {days}d</span>}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                { label: "Case manager", value: s.case_manager || "—" },
              ]}
            />
          </section>
        )}

        <section>
          <Label as="h3" className="mb-3">
            Learning profile
          </Label>
          <DetailList
            items={[
              { label: "Reading level", value: s.reading_level || "—" },
              { label: "English learner", value: s.el_level || "—" },
              { label: "Home language", value: s.home_language || "—" },
            ]}
          />
        </section>

        <p className="text-[13px] leading-5 text-faint">The assistant uses this profile when you ask about this class. Only this section's teacher and admins can see it.</p>
      </div>
    </Sheet>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <SearchX className="h-5 w-5 text-faint" strokeWidth={1.5} aria-hidden />
      <p className="mt-2 text-sm text-ink">No students match</p>
      <button className={`${linkClass} mt-1`} onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

function EmptyRoster({ isAdmin, onImport }: { isAdmin: boolean; onImport: () => void }) {
  return (
    <div className="ws-rise mt-8 flex flex-col items-center border border-dashed border-line-strong bg-panel px-6 py-16 text-center">
      <Users className="h-6 w-6 text-faint" strokeWidth={1.5} aria-hidden />
      <h2 className="mt-4 text-[19px] font-normal text-ink">{isAdmin ? "No roster yet" : "No sections assigned to you"}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {isAdmin ? "Import a CSV with one row per student per section. The template shows the columns." : "Ask your administrator to import the roster with your email as the teacher."}
      </p>
      {isAdmin && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={onImport}>
            <Upload className="h-4 w-4" aria-hidden /> Import CSV
          </button>
          <a className="btn-secondary" href="/api/roster/template.csv">
            <Download className="h-4 w-4" aria-hidden /> Template
          </a>
        </div>
      )}
    </div>
  );
}

function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(iso: string, short = false) {
  return parseDate(iso).toLocaleDateString(undefined, short ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
