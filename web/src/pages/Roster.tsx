import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquareText } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Section, Student } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton } from "../components/ui";
import { Chip, Page, PageTitle, SearchField, Sheet, linkClass, useLast } from "../components/workspace/primitives";

const DAY = 86400000;

/** The Ask page reads `q` from /chat?q=… and prefills the composer with it. */
export function askHref(question: string) {
  return `/chat?q=${encodeURIComponent(question)}`;
}

export function Roster() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [section, setSection] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ sections: Section[]; students: Student[] }>("/api/roster")
      .then((r) => {
        setSections(r.sections);
        setStudents(r.students);
      })
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);

  const reviewIn = useCallback((s: Student) => {
    if (!s.iep_review_date) return null;
    const days = Math.round((parseDate(s.iep_review_date).getTime() - startOfToday()) / DAY);
    return days >= 0 && days <= 30 ? days : null;
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter(
      (s) => (section === "all" || s.section_id === section) && (!q || s.name.toLowerCase().includes(q) || s.accommodations.some((a) => a.toLowerCase().includes(q))),
    );
  }, [students, section, query]);

  // "All sections" with more than one: group under a quiet section heading instead of repeating it per row.
  const groups = useMemo(() => {
    if (section !== "all" || (sections?.length ?? 0) < 2) return [{ key: "all", label: null as string | null, students: visible }];
    return (sections ?? [])
      .map((sec) => ({ key: String(sec.id), label: sectionLabel(sec) as string | null, students: visible.filter((s) => s.section_id === sec.id) }))
      .filter((g) => g.students.length > 0);
  }, [section, sections, visible]);

  const open = useLast(students.find((s) => s.id === openId) ?? null);
  const multi = (sections?.length ?? 0) > 1;
  const isAdmin = user?.role === "admin";

  return (
    <Page>
      <PageTitle
        title="Students"
        stretch
        actions={
          sections && sections.length > 0 ? (
            <>
              {multi && (
                <select className="input h-9 w-auto min-w-0 max-w-[180px] shrink-0 pr-8 text-sm" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value === "all" ? "all" : Number(e.target.value))}>
                  <option value="all">All sections</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionLabel(s)}
                    </option>
                  ))}
                </select>
              )}
              <SearchField value={query} onChange={setQuery} placeholder="Search students" className="min-w-0 flex-1 sm:w-56 sm:flex-none" />
            </>
          ) : undefined
        }
      />

      <div className="mt-10">
        {sections === null ? (
          <ul className="divide-y divide-line" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-4 py-5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto hidden h-5 w-56 sm:block" />
              </li>
            ))}
          </ul>
        ) : sections.length === 0 ? (
          <div className="ws-rise flex flex-col items-center py-24 text-center">
            <p className="text-base text-muted">{isAdmin ? "No students yet." : "No classes are assigned to you yet."}</p>
            {isAdmin && (
              <Link to="/admin" className="btn-primary mt-6">
                Import roster
              </Link>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="text-base text-muted">No students match.</p>
            <button className={`${linkClass} mt-2`} onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        ) : (
          <div className="space-y-12">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label ?? "Students"}>
                {g.label && <h2 className="mb-1 text-sm text-faint">{g.label}</h2>}
                <ul className="ws-stagger divide-y divide-line">
                  {g.students.map((s, i) => (
                    <li key={s.id} style={{ ["--i" as string]: i }}>
                      <StudentRow s={s} due={reviewIn(s)} onOpen={() => setOpenId(s.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={!!openId}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open?.name ?? ""}
        description={open ? [sectionLabel(open), open.grade && `Grade ${open.grade}`].filter(Boolean).join(" · ") : undefined}
        footer={
          open && (
            <button className="btn-primary w-full sm:w-auto" onClick={() => navigate(askHref(`What accommodations does ${open.name} have?`))}>
              <MessageSquareText className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Ask about {open.name.split(" ")[0]}
            </button>
          )
        }
      >
        {open && <StudentDetails s={open} due={reviewIn(open)} />}
      </Sheet>
    </Page>
  );
}

/* ------------------------------------------------------------------ Pieces */

function sectionLabel(s: { section_name?: string; name?: string; period: string }) {
  const name = s.section_name ?? s.name ?? "";
  return s.period ? `${name} · Period ${s.period}` : name;
}

function PlanTags({ s }: { s: Student }) {
  return (
    <>
      {s.plan_type && <Chip tone="strong">{s.plan_type}</Chip>}
      {s.el_level && <Chip tone="strong">EL</Chip>}
    </>
  );
}

function Accommodations({ list, max }: { list: string[]; max: number }) {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  return (
    <>
      {shown.map((a) => (
        <Chip key={a} className="max-w-[220px]">
          <span className="truncate">{a}</span>
        </Chip>
      ))}
      {more > 0 && (
        <Chip className="text-faint" title={list.slice(max).join(", ")}>
          +{more}
        </Chip>
      )}
    </>
  );
}

function reviewText(due: number) {
  return `Review ${due === 0 ? "today" : `in ${due} ${due === 1 ? "day" : "days"}`}`;
}

function StudentRow({ s, due, onOpen }: { s: Student; due: number | null; onOpen: () => void }) {
  return (
    <button
      data-student-row
      type="button"
      onClick={onOpen}
      className="-mx-3 flex w-[calc(100%+24px)] flex-col gap-2 rounded-[2px] px-3 py-4 text-left transition-colors duration-100 hover:bg-subtle/60 focus-visible:bg-subtle/60 sm:flex-row sm:items-center sm:gap-6 sm:py-5"
    >
      <span className="flex min-w-0 items-baseline justify-between gap-3 sm:w-52 sm:shrink-0">
        <span className="truncate text-base text-ink">{s.name}</span>
        {due !== null && <span className="shrink-0 text-sm text-warning sm:hidden">{reviewText(due)}</span>}
      </span>
      {(s.plan_type || s.el_level || s.accommodations.length > 0) && (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <PlanTags s={s} />
          <Accommodations list={s.accommodations} max={2} />
        </span>
      )}
      {due !== null && <span className="ml-auto hidden shrink-0 text-sm text-warning sm:block">{reviewText(due)}</span>}
    </button>
  );
}

function StudentDetails({ s, due }: { s: Student; due: number | null }) {
  const rows: [string, ReactNode][] = [
    ["Next review", s.iep_review_date ? formatDate(s.iep_review_date) : ""],
    ["Case manager", s.case_manager],
    ["Reading level", s.reading_level],
    ["English learner", s.el_level],
    ["Home language", s.home_language],
  ];
  return (
    <div className="space-y-8">
      {(s.plan_type || s.el_level || due !== null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <PlanTags s={s} />
          {due !== null && <span className="ml-1.5 text-sm text-warning">{reviewText(due)}</span>}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm text-faint">Accommodations</h3>
        {s.accommodations.length ? (
          <ul className="divide-y divide-line">
            {s.accommodations.map((a) => (
              <li key={a} className="py-2.5 text-base text-ink">
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2.5 text-base text-faint">None on file</p>
        )}
      </section>

      <dl className="divide-y divide-line">
        {rows
          .filter(([, v]) => !!v)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-6 py-2.5 text-sm">
              <dt className="shrink-0 text-faint">{k}</dt>
              <dd className="min-w-0 text-right text-ink">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(iso: string) {
  return parseDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
