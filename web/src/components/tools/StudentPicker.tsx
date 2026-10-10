import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Section, Student } from "../../lib/types";

interface Roster {
  sections: Section[];
  students: Student[];
}

let cache: Promise<Roster> | null = null;

/** The teacher's own roster (GET /api/roster is already scoped to them). Fetched once per visit. */
export function useRoster() {
  const [roster, setRoster] = useState<Roster | null>(null);
  useEffect(() => {
    if (!cache) {
      cache = api.get<Roster>("/api/roster").catch(() => {
        cache = null;
        return { sections: [], students: [] };
      });
    }
    let alive = true;
    cache.then((r) => alive && setRoster(r));
    return () => {
      alive = false;
    };
  }, []);
  return roster;
}

export function useStudent(id: number | null | undefined): Student | null {
  const roster = useRoster();
  return useMemo(() => roster?.students.find((s) => s.id === id) ?? null, [roster, id]);
}

/** A plain select of the teacher's students, grouped by section when they teach more than one. */
export function StudentPicker({
  value,
  onChange,
  id,
  required,
  placeholder = "No student",
}: {
  value: number | null;
  onChange: (id: number | null, student: Student | null) => void;
  id?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const roster = useRoster();
  const groups = useMemo(() => {
    const students = [...(roster?.students ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const bySection = new Map<string, Student[]>();
    for (const s of students) {
      const key = s.section_name || "";
      bySection.set(key, [...(bySection.get(key) ?? []), s]);
    }
    return [...bySection.entries()];
  }, [roster]);

  const option = (s: Student) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  );

  return (
    <select
      id={id}
      className="input"
      value={value ?? ""}
      required={required}
      disabled={!roster}
      onChange={(e) => {
        const v = e.target.value ? Number(e.target.value) : null;
        onChange(v, roster?.students.find((s) => s.id === v) ?? null);
      }}
    >
      <option value="">{roster && roster.students.length === 0 ? "No students yet" : placeholder}</option>
      {groups.length > 1
        ? groups.map(([name, list]) => (
            <optgroup key={name} label={name || "Students"}>
              {list.map(option)}
            </optgroup>
          ))
        : groups.flatMap(([, list]) => list.map(option))}
    </select>
  );
}
