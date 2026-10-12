import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Trash2, Upload } from "lucide-react";
import { api, formatBytes } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { ModelInfo, Preset, PullState, RuntimeConfigPublic, RuntimeHealth } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton, Spinner } from "../components/ui";
import { useHealth } from "../components/shell/health";
import { Bar, Callout, Chip, ConfirmDialog, Disclosure, Modal, ModalFooter, Page, PageTitle, SearchField, Section, linkClass } from "../components/workspace/primitives";

/** Settings (admins): People, AI, Connection on one page. */
export function Admin() {
  // On a teacher's own Mac (personal desk) the school runs the AI: no connection settings.
  const local = !!useHealth()?.local;
  return (
    <Page>
      <PageTitle title="Settings" />
      <div className="mt-12 space-y-20">
        <People />
        <AiModels />
        {!local && <ActivityLog />}
        {!local && <Connection />}
      </div>
      {!local && (
        <p className="mt-20 text-sm text-faint">
          Teachers can install the Mac app from{" "}
          <a href="/get" className={linkClass}>
            {window.location.host}/get
          </a>
        </p>
      )}
    </Page>
  );
}

/* ================================================================ People */

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  section_count: number;
}

const EMPTY_PERSON = { name: "", email: "", role: "teacher", password: "" };

function People() {
  const local = !!useHealth()?.local;
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_PERSON);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<UserRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ users: UserRow[] }>("/api/admin/users")
      .then((r) => setUsers(r.users))
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);
  useEffect(load, [load]);

  async function add() {
    setSaving(true);
    try {
      await api.post("/api/admin/users", form);
      toast({ kind: "success", message: `Added ${form.name || form.email}.` });
      setForm(EMPTY_PERSON);
      setAdding(false);
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: UserRow) {
    try {
      await api.del(`/api/admin/users/${u.id}`);
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
    setConfirm(null);
  }

  return (
    <Section
      title="People"
      aside={
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" strokeWidth={1.75} aria-hidden /> <span className="hidden sm:inline">Import roster (CSV)</span>
            <span className="sm:hidden">Import roster</span>
          </button>
          {!adding && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              Add person
            </button>
          )}
        </div>
      }
    >
      {adding && (
        <form
          className="bg-ink/[0.04] ws-rise mb-4 grid gap-3 p-4 sm:grid-cols-2 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="input" aria-label="Name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <input className="input" aria-label="Email" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input
            className="input"
            aria-label="Temporary password"
            type="password"
            placeholder="Temporary password (8+ characters)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <select className="input" aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setAdding(false);
                setForm(EMPTY_PERSON);
              }}
            >
              Cancel
            </button>
            <button className="btn-primary" disabled={saving}>
              {saving && <Spinner />} Add
            </button>
          </div>
        </form>
      )}

      {!users ? (
        <div className="space-y-3 py-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <ul className="ws-stagger divide-y divide-line border-y border-line">
          {users.map((u, i) => (
            <li key={u.id} style={{ ["--i" as string]: i }} className="group flex items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base text-ink">
                  {u.name || u.email}
                  {u.id === me?.id && <span className="ml-1.5 text-sm text-faint">(you)</span>}
                </div>
                <div className="truncate text-sm text-faint">{u.email}</div>
              </div>
              <span className="shrink-0 text-sm text-muted">{u.role === "admin" ? "Admin" : "Teacher"}</span>
              <span className="flex w-8 shrink-0 justify-end">
                {u.id !== me?.id && (
                  <button
                    className="btn-ghost btn-icon h-8 w-8 text-faint transition-opacity hover:text-danger focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={() => setConfirm(u)}
                    aria-label={`Remove ${u.name || u.email}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.name || confirm?.email}?`}
        body="They can no longer sign in. Their classes stay and relink if you add them again with the same email."
        confirmLabel="Remove"
        onConfirm={() => confirm && remove(confirm)}
      />

      <PersonalMacs />
      {!local && <SignInSettings />}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Section>
  );
}

/* ---------------------------------------------------------------- Sign in with Google / Microsoft */

interface SSOConfig {
  google_client_id: string;
  google_has_secret: boolean;
  google_secret_hint: string;
  microsoft_client_id: string;
  microsoft_has_secret: boolean;
  microsoft_secret_hint: string;
  microsoft_tenant: string;
  domains: string[];
  auto_join: boolean;
  enabled: string[];
  redirect_uris: Record<string, string>;
}

/** For IT: the school's own Google / Microsoft app, so teachers sign in with their school
 *  account. Step-by-step, with the exact address to paste. */
function SignInSettings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<SSOConfig | null>(null);
  const [form, setForm] = useState({ google_client_id: "", google_client_secret: "", microsoft_client_id: "", microsoft_client_secret: "", microsoft_tenant: "", domains: "", auto_join: false });
  const [saving, setSaving] = useState(false);
  const fill = (c: SSOConfig) => {
    setCfg(c);
    setForm({ google_client_id: c.google_client_id, google_client_secret: "", microsoft_client_id: c.microsoft_client_id, microsoft_client_secret: "", microsoft_tenant: c.microsoft_tenant, domains: c.domains.join(", "), auto_join: c.auto_join });
  };
  useEffect(() => {
    api.get<SSOConfig>("/api/admin/sso").then(fill).catch(() => setCfg(null));
  }, []);
  if (!cfg) return null;

  async function save() {
    setSaving(true);
    try {
      const c = await api.put<SSOConfig>("/api/admin/sso", form);
      fill(c);
      toast({ kind: "success", message: c.enabled.length ? `Sign in with ${c.enabled.map((p) => (p === "google" ? "Google" : "Microsoft")).join(" and ")} is on.` : "Saved." });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const on = cfg.enabled;

  return (
    <div className="mt-10">
      <Disclosure label={on.length ? `Sign-in · ${on.map((p) => (p === "google" ? "Google" : "Microsoft")).join(" and ")} on` : "Sign in with Google or Microsoft"}>
        <form
          className="grid max-w-2xl gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="grid gap-1.5">
            <span className="field-label">School email domain</span>
            <input className="input" placeholder="shipleyschool.org" value={form.domains} onChange={set("domains")} />
            <span className="text-xs text-faint">Only accounts at this domain can sign in. Separate several with commas.</span>
          </label>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm text-ink">Google Workspace</legend>
            <p className="text-sm text-muted">
              In Google Cloud Console → APIs &amp; Services → Credentials, create an OAuth client (Web application) and add this
              redirect address:
            </p>
            <code className="block overflow-x-auto whitespace-nowrap bg-ink/[0.04] px-3 py-2 font-mono text-[13px]">{cfg.redirect_uris.google}</code>
            <input className="input" aria-label="Google client ID" placeholder="Client ID" value={form.google_client_id} onChange={set("google_client_id")} />
            <input className="input" aria-label="Google client secret" type="password" autoComplete="off" placeholder={cfg.google_has_secret ? `Client secret (saved ${cfg.google_secret_hint})` : "Client secret"} value={form.google_client_secret} onChange={set("google_client_secret")} />
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm text-ink">Microsoft 365</legend>
            <p className="text-sm text-muted">In Microsoft Entra → App registrations, register an app (Web) with this redirect address, then add a client secret:</p>
            <code className="block overflow-x-auto whitespace-nowrap bg-ink/[0.04] px-3 py-2 font-mono text-[13px]">{cfg.redirect_uris.microsoft}</code>
            <input className="input" aria-label="Microsoft application (client) ID" placeholder="Application (client) ID" value={form.microsoft_client_id} onChange={set("microsoft_client_id")} />
            <input className="input" aria-label="Microsoft client secret" type="password" autoComplete="off" placeholder={cfg.microsoft_has_secret ? `Client secret (saved ${cfg.microsoft_secret_hint})` : "Client secret value"} value={form.microsoft_client_secret} onChange={set("microsoft_client_secret")} />
            <input className="input" aria-label="Microsoft directory (tenant) ID" placeholder="Directory (tenant) ID (optional)" value={form.microsoft_tenant === "organizations" ? "" : form.microsoft_tenant} onChange={(e) => setForm({ ...form, microsoft_tenant: e.target.value || "organizations" })} />
          </fieldset>

          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-1" checked={form.auto_join} onChange={set("auto_join")} />
            <span>
              Anyone at the domain can join as a teacher
              <span className="block text-faint">Off: only people you've added can sign in.</span>
            </span>
          </label>

          <div>
            <button className="btn-primary" disabled={saving}>
              {saving && <Spinner />} Save
            </button>
          </div>
        </form>
      </Disclosure>
    </div>
  );
}

/* ---------------------------------------------------------------- Macs keeping their own data */

interface DeviceRow {
  id: number;
  label: string;
  name: string;
  email: string;
  created_at: string;
  last_used_at: string | null;
}

/** Teachers who chose "Keep my data on this Mac": their Mac uses this school's AI. Shown
 *  only when there are some; Remove cuts that Mac off from the AI. */
function PersonalMacs() {
  const toast = useToast();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [confirm, setConfirm] = useState<DeviceRow | null>(null);
  const load = useCallback(() => {
    api
      .get<{ devices: DeviceRow[] }>("/api/admin/devices")
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);
  useEffect(load, [load]);
  if (!devices.length) return null;

  async function remove(d: DeviceRow) {
    try {
      await api.del(`/api/admin/devices/${d.id}`);
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
    setConfirm(null);
  }

  return (
    <div className="mt-10">
      <h3 className="text-sm text-muted">Macs keeping their own data</h3>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {devices.map((d) => (
          <li key={d.id} className="group flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base text-ink">{d.name || d.email}</div>
              <div className="truncate text-sm text-faint">{d.label || "Mac"}</div>
            </div>
            <span className="shrink-0 text-sm text-muted">{d.last_used_at ? `Used ${ago(d.last_used_at)}` : "Not used yet"}</span>
            <span className="flex w-8 shrink-0 justify-end">
              <button
                className="btn-ghost btn-icon h-8 w-8 text-faint transition-opacity hover:text-danger focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={() => setConfirm(d)}
                aria-label={`Remove ${d.label || "Mac"} of ${d.name || d.email}`}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.label || "this Mac"}?`}
        body="It can no longer use the school's AI. The teacher's data stays on their Mac."
        confirmLabel="Remove"
        onConfirm={() => confirm && remove(confirm)}
      />
    </div>
  );
}

/* ================================================================ Activity */

interface ActivityRow {
  id: number;
  who: string;
  action: string;
  what: string;
  subject: string;
  detail: string;
  created_at: string;
}

/** Who signed in, whose student information was used, what changed. Never question text. */
function ActivityLog() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(
    (before?: number) => {
      const params = new URLSearchParams({ q });
      if (before) params.set("before", String(before));
      api
        .get<{ activity: ActivityRow[]; more: boolean }>(`/api/admin/activity?${params}`)
        .then((r) => {
          setRows((prev) => (before && prev ? [...prev, ...r.activity] : r.activity));
          setMore(r.more);
        })
        .catch(() => setRows([]));
    },
    [q],
  );
  useEffect(() => {
    const t = window.setTimeout(() => load(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  return (
    <Section
      title="Activity"
      aside={
        <a className="btn-secondary" href={`/api/admin/activity.csv?${new URLSearchParams({ q })}`}>
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Download CSV
        </a>
      }
    >
      <SearchField value={q} onChange={setQ} placeholder="Search a person or student" className="mb-4 max-w-sm" />
      {!rows ? (
        <div className="space-y-3 py-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-sm text-faint">{q ? "Nothing matches." : "Nothing yet."}</p>
      ) : (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {rows.map((a) => (
              <li key={a.id} className="flex items-baseline gap-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {a.who || a.subject || "Someone"} <span className="text-muted">{a.what}</span>
                  {a.who && a.subject ? ` ${a.subject}` : ""}
                  {a.detail && <span className="text-faint"> · {a.detail}</span>}
                </span>
                <span className="shrink-0 text-faint" title={`${a.created_at} UTC`}>
                  {ago(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
          {more && (
            <button className="btn-ghost mt-3" onClick={() => load(rows[rows.length - 1].id)}>
              Show older
            </button>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-faint">Kept for a year. Questions and documents themselves are never recorded here.</p>
    </Section>
  );
}

/** "2 hours ago" from a UTC SQLite timestamp. */
function ago(sqliteUtc: string): string {
  const t = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}

/* ---------------------------------------------------------------- Roster import */

interface Preview {
  students: number;
  sections: { name: string; period: string }[];
  errors: string[];
  warnings: string[];
  preview: Record<string, string>[];
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; data: Preview } | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) setPreview(null);
  }, [open]);

  async function choose(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setChecking(true);
    try {
      setPreview({ file, data: await api.post<Preview>("/api/roster/preview", fd) });
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setChecking(false);
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
      toast({ kind: "success", message: `Imported ${r.students} students in ${r.sections} classes.` });
      if (r.unmatched_teachers.length) toast({ kind: "info", message: `No account yet for ${r.unmatched_teachers.join(", ")}. Their classes link once you add them.` });
      onOpenChange(false);
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  const d = preview?.data;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Import roster" description="Importing replaces the current roster. People's accounts stay." width={d ? 720 : 520}>
      {!d ? (
        <div className="px-6 pb-6 pt-4">
          <button
            type="button"
            data-autofocus
            onClick={() => fileInput.current?.click()}
            disabled={checking}
            className="group flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-12 text-center transition-colors duration-150 hover:border-ink/50 hover:bg-subtle/40"
          >
            {checking ? <Spinner className="h-5 w-5 text-muted" /> : <Upload className="h-5 w-5 text-faint group-hover:text-ink" strokeWidth={1.5} aria-hidden />}
            <span className="mt-3 text-base text-ink">{checking ? "Checking the file…" : "Choose a CSV file"}</span>
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
          <a className={`${linkClass} mt-5 inline-flex items-center gap-1.5`} href="/api/roster/template.csv">
            <Download className="h-3.5 w-3.5" aria-hidden /> Download the template
          </a>
        </div>
      ) : (
        <>
          <div className="space-y-6 px-6 pb-6 pt-4">
            <p className="text-base text-ink">
              {d.students} students in {d.sections.length} {d.sections.length === 1 ? "class" : "classes"}
              <span className="text-faint"> · {preview!.file.name}</span>
            </p>
            {d.errors.length > 0 && (
              <Callout tone="danger" title="Fix these before importing">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {d.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Callout>
            )}
            {d.warnings.length > 0 && (
              <Callout tone="warning" title="Worth a look">
                <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                  {d.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Callout>
            )}
            {d.sections.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.sections.map((s) => (
                  <Chip key={`${s.name}-${s.period}`}>
                    {s.name}
                    {s.period && <span className="text-faint">· P{s.period}</span>}
                  </Chip>
                ))}
              </div>
            )}
            {d.preview.length > 0 && (
              <div className="bg-ink/[0.04] max-h-[240px] overflow-auto ">
                <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-faint">
                      {["Student", "Class", "Teacher", "Accommodations"].map((h) => (
                        <th key={h} className="sticky top-0 border-b border-line bg-panel px-3 py-2 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.preview.map((r, i) => (
                      <tr key={i} className="[&>td]:border-b [&>td]:border-line [&:last-child>td]:border-b-0">
                        <td className="whitespace-nowrap px-3 py-2 text-ink">{r.student_name}</td>
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
          </div>
          <ModalFooter>
            <button className="btn-secondary" onClick={() => setPreview(null)}>
              Choose another file
            </button>
            <button className="btn-danger-solid" disabled={importing || d.errors.length > 0} onClick={confirmImport}>
              {importing && <Spinner />} Replace roster
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

/* ================================================================ AI */

interface ModelsData {
  installed: ModelInfo[];
  error: string;
  active: { chat: string; embed: string };
  presets: { chat?: Preset[]; embed?: Preset[] };
  pulls: PullState[];
  capabilities: { pull: boolean; delete: boolean };
}

/** GET/PUT /api/admin/models/choices (v2 server). */
interface Choice {
  model: string;
  label: string;
  description: string;
  installed?: boolean;
}
interface Choices {
  default: string;
  options: Choice[];
}

interface Row {
  model: string;
  on: boolean;
  label: string;
  description: string;
  installed: boolean;
}

const bare = (n: string) => n.replace(/:latest$/, "");

function AiModels() {
  const toast = useToast();
  const { refresh } = useStatus();
  const [data, setData] = useState<ModelsData | null>(null);
  /** undefined = loading, null = this server has no choices endpoint yet. */
  const [choices, setChoices] = useState<Choices | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [def, setDef] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadModels = useCallback(() => {
    api.get<ModelsData>("/api/admin/models").then(setData).catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);
  const loadChoices = useCallback(() => {
    api
      .get<Choices>("/api/admin/models/choices")
      .then((c) => {
        setChoices(c);
        setDirty(false);
      })
      // Before the v2 server lands this 404s: fall back to the single active-model control.
      .catch(() => setChoices(null));
  }, []);
  useEffect(loadModels, [loadModels]);
  useEffect(loadChoices, [loadChoices]);

  const pulling = data?.pulls.some((p) => !p.done);
  useEffect(() => {
    if (!pulling) return;
    const t = window.setInterval(loadModels, 1500);
    return () => window.clearInterval(t);
  }, [pulling, loadModels]);

  // Chat models only: the embedding model isn't something teachers pick.
  const chatInstalled = useMemo(() => {
    if (!data) return [];
    const embeds = new Set([data.active.embed, ...(data.presets.embed ?? []).map((p) => p.name)].map(bare));
    return data.installed.filter((m) => !embeds.has(bare(m.name)) && !/embed/i.test(m.name));
  }, [data]);

  // Merge configured choices with installed chat models whenever either changes (unless editing).
  useEffect(() => {
    if (!data || !choices || dirty) return;
    const installed = new Set(chatInstalled.map((m) => bare(m.name)));
    const configured = choices.options.map((o) => ({ model: o.model, on: true, label: o.label, description: o.description, installed: o.installed ?? installed.has(bare(o.model)) }));
    const seen = new Set(configured.map((r) => bare(r.model)));
    const extra = chatInstalled.filter((m) => !seen.has(bare(m.name))).map((m) => ({ model: m.name, on: false, label: "", description: "", installed: true }));
    setRows([...configured, ...extra]);
    setDef(choices.default);
  }, [data, choices, chatInstalled, dirty]);

  const edit = (model: string, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => {
      const next = rs.map((r) => (r.model === model ? { ...r, ...patch } : r));
      const on = next.filter((r) => r.on);
      if (on.length && !on.some((r) => r.model === def)) setDef(on[0].model);
      return next;
    });
  };

  async function save() {
    const on = rows.filter((r) => r.on);
    setSaving(true);
    try {
      await api.put("/api/admin/models/choices", {
        options: on.map((r) => ({ model: r.model, label: r.label.trim() || r.model, description: r.description.trim() })),
        default: on.some((r) => r.model === def) ? def : on[0]?.model,
      });
      toast({ kind: "success", message: "Saved. Teachers see the new choices on their next question." });
      setDirty(false);
      loadChoices();
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function activate(model: string) {
    try {
      await api.put("/api/admin/models/active", { role: "chat", model });
      toast({ kind: "success", message: `${model} now answers questions.` });
      loadModels();
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }

  const loading = !data || choices === undefined;
  const on = rows.filter((r) => r.on);

  return (
    <Section title="AI">
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-6">
          {data.error && <Callout tone="danger" title="Can't reach the assistant">{data.error}</Callout>}

          {choices ? (
            <div>
              <h3 className="mb-3 text-sm text-faint">Models teachers can choose</h3>
              {rows.length === 0 ? (
                <p className="border-y border-line py-4 text-sm text-muted">No chat models are downloaded yet.</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {rows.map((r) => (
                    <li key={r.model} className={clsx("flex items-start gap-3 py-3 transition-opacity sm:items-center", !r.on && "opacity-60 hover:opacity-100 focus-within:opacity-100")}>
                      <input type="checkbox" className="checkbox mt-2.5 sm:mt-0" checked={r.on} onChange={(e) => edit(r.model, { on: e.target.checked })} aria-label={`Offer ${r.label || r.model}`} />
                      <div className="grid min-w-0 flex-1 items-center gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                        <input
                          className="input h-9 border-transparent bg-transparent px-2 text-base hover:border-line focus:border-line-strong"
                          value={r.label}
                          placeholder={r.on ? "Name" : "Add a name"}
                          aria-label={`Name for ${r.model}`}
                          onChange={(e) => edit(r.model, { label: e.target.value, on: true })}
                        />
                        <input
                          className="input h-9 border-transparent bg-transparent px-2 text-sm text-muted hover:border-line focus:border-line-strong"
                          value={r.description}
                          placeholder="One line for teachers"
                          aria-label={`Description for ${r.model}`}
                          onChange={(e) => edit(r.model, { description: e.target.value, on: true })}
                        />
                        <div className="px-2 font-mono text-xs text-faint sm:px-0 sm:text-right">
                          {!r.installed && <span className="mr-2 font-sans text-warning">Not downloaded</span>}
                          {r.model}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <label htmlFor="ai-default" className="text-sm text-muted">
                  Default
                </label>
                <select id="ai-default" className="input h-9 w-auto min-w-[160px] pr-8 text-sm" value={def} onChange={(e) => (setDef(e.target.value), setDirty(true))} disabled={!on.length}>
                  {on.map((r) => (
                    <option key={r.model} value={r.model}>
                      {r.label || r.model}
                    </option>
                  ))}
                </select>
                <span className="flex-1" />
                {dirty && (
                  <button className="btn-ghost" onClick={() => setDirty(false)}>
                    Discard
                  </button>
                )}
                <button className="btn-primary" disabled={!dirty || saving || !on.length} onClick={save}>
                  {saving && <Spinner />} Save
                </button>
              </div>
            </div>
          ) : (
            // Older server: one model answers everything.
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="ai-active" className="text-sm text-muted">
                Answers with
              </label>
              {chatInstalled.length ? (
                <select id="ai-active" className="input h-9 w-auto min-w-[220px] pr-8 font-mono text-[13px]" value={chatInstalled.some((m) => m.name === data.active.chat) ? data.active.chat : ""} onChange={(e) => e.target.value && activate(e.target.value)}>
                  <option value="">Choose a model…</option>
                  {chatInstalled.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-mono text-[13px] text-ink">{data.active.chat}</span>
              )}
            </div>
          )}

          {data.capabilities.pull && (
            <Disclosure label="Download another model" defaultOpen={!!pulling}>
              <DownloadModels data={data} installed={chatInstalled} onChange={loadModels} />
            </Disclosure>
          )}
        </div>
      )}
    </Section>
  );
}

function DownloadModels({ data, installed, onChange }: { data: ModelsData; installed: ModelInfo[]; onChange: () => void }) {
  const toast = useToast();
  const [custom, setCustom] = useState("");
  const have = new Set(installed.map((m) => bare(m.name)));
  const presets = (data.presets.chat ?? []).filter((p) => !have.has(bare(p.name)));
  const pulls = data.pulls.filter((p) => !p.done || p.error);

  async function pull(model: string) {
    try {
      await api.post("/api/admin/models/pull", { model });
      onChange();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      {presets.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {presets.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-sm text-ink">
                  {p.label} <span className="ml-1 font-mono text-xs text-faint">{p.name}</span>
                </div>
                {p.note && <p className="mt-0.5 text-sm text-muted">{p.note}</p>}
              </div>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => pull(p.name)} disabled={data.pulls.some((x) => x.model === p.name && !x.done)}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Download
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) pull(custom.trim());
          setCustom("");
        }}
      >
        <input className="input h-9 font-mono text-[13px]" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Model name, e.g. llama3.1:8b" aria-label="Model name" />
        <button className="btn-secondary shrink-0" disabled={!custom.trim()}>
          Download
        </button>
      </form>
      {pulls.map((p) => (
        <div key={p.model}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="font-mono text-[13px] text-ink">{p.model}</span>
            <span className={clsx("text-xs", p.error ? "text-danger" : "text-faint")}>
              {p.error ? "Failed" : p.total ? `${formatBytes(p.completed)} of ${formatBytes(p.total)}` : "Starting…"}
            </span>
          </div>
          {p.error ? <p className="text-sm text-danger">{p.error}</p> : <Bar value={p.percent} />}
        </div>
      ))}
    </div>
  );
}

/* ================================================================ Connection */

const KINDS = [
  { id: "ollama", label: "Ollama" },
  { id: "openai", label: "OpenAI-compatible" },
  { id: "fake", label: "Offline demo" },
];

function Connection() {
  const toast = useToast();
  const { status, refresh } = useStatus();
  const [cfg, setCfg] = useState<RuntimeConfigPublic | null>(null);
  const [kind, setKind] = useState("ollama");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ health: RuntimeHealth; models: ModelInfo[] } | null>(null);

  useEffect(() => {
    api
      .get<{ config: RuntimeConfigPublic }>("/api/admin/runtime")
      .then((r) => {
        setCfg(r.config);
        setKind(r.config.kind);
        setUrl(r.config.url);
      })
      .catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);

  const body = () => ({ kind, url, token: token || null, headers: headers || null });

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post("/api/admin/runtime/test", body()));
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ config: RuntimeConfigPublic }>("/api/admin/runtime", body());
      setCfg(r.config);
      setToken("");
      setHeaders("");
      toast({ kind: "success", message: "Saved." });
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const down = result ? !result.health.ok : status?.runtime.state === "unreachable";
  const known = !!result || status?.runtime.state === "connected" || !!status?.runtime.last_ok || cfg?.kind === "fake";
  const error = result ? result.health.error : status?.runtime.error;

  return (
    <Section title="Connection">
      {!cfg ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 border-y border-line py-4">
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", down ? "bg-danger" : known ? "bg-success" : "bg-faint")} aria-hidden />
            <span className="text-base text-ink">{down ? "Can't reach the assistant" : known ? "Connected" : "Not checked yet"}</span>
            {down && error && <span className="min-w-0 truncate text-sm text-faint" title={error}>{error}</span>}
          </div>

          <Disclosure label="Advanced">
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div>
                <label className="field-label" htmlFor="rt-kind">
                  Type
                </label>
                <select id="rt-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="rt-url">
                  URL
                </label>
                <input id="rt-url" className="input font-mono text-[13px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required={kind !== "fake"} disabled={kind === "fake"} />
              </div>
              <div>
                <label className="field-label" htmlFor="rt-token">
                  Access token
                </label>
                <input
                  id="rt-token"
                  className="input font-mono text-[13px]"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={cfg.has_token ? `Saved (${cfg.token}). Leave blank to keep.` : "Optional"}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rt-headers">
                  Extra headers (JSON)
                </label>
                <textarea
                  id="rt-headers"
                  className="input h-20 resize-y py-2 font-mono text-[13px]"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder={cfg.headers ? `Saved: ${cfg.headers}. Leave blank to keep.` : '{"X-Api-Key": "…"}'}
                />
              </div>
              {result && (
                <p className={clsx("text-sm", result.health.ok ? "text-success" : "text-danger")} role="status">
                  {result.health.ok
                    ? `Connected${result.health.latency_ms != null ? ` in ${result.health.latency_ms} ms` : ""} · ${result.models.length} model${result.models.length === 1 ? "" : "s"}`
                    : result.health.error || "Couldn't connect."}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={test} disabled={testing || (!url && kind !== "fake")}>
                  {testing && <Spinner />} Test
                </button>
                <button className="btn-primary" disabled={saving || (!url && kind !== "fake")}>
                  {saving && <Spinner />} Save
                </button>
              </div>
            </form>
          </Disclosure>
        </div>
      )}
    </Section>
  );
}
