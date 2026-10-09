import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Cpu, Download, Plug, Server, Trash2, UserPlus } from "lucide-react";
import { api, formatBytes } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { ModelInfo, Preset, PullState, RuntimeConfigPublic, RuntimeHealth } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Badge, Dot, Field, PageHeader, Progress, Skeleton, Spinner } from "../components/ui";

type Tab = "runtime" | "models" | "people";

export function Admin() {
  const [tab, setTab] = useState<Tab>("runtime");
  const tabs: { id: Tab; label: string }[] = [
    { id: "runtime", label: "Runtime" },
    { id: "models", label: "Models" },
    { id: "people", label: "People" },
  ];
  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 md:px-8 md:py-10">
      <PageHeader title="Admin" description="Connect the GPU runtime, choose which models answer, and manage who can sign in." />
      <div className="mt-6 flex gap-5 border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
              tab === t.id ? "border-ink text-ink" : "border-transparent text-faint hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "runtime" && <RuntimeTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "people" && <PeopleTab />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Runtime */

function RuntimeTab() {
  const toast = useToast();
  const { refresh } = useStatus();
  const [cfg, setCfg] = useState<RuntimeConfigPublic | null>(null);
  const [kind, setKind] = useState("ollama");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ health: RuntimeHealth; models: ModelInfo[]; is_local: boolean } | null>(null);

  useEffect(() => {
    api.get<{ config: RuntimeConfigPublic }>("/api/admin/runtime").then((r) => {
      setCfg(r.config);
      setKind(r.config.kind);
      setUrl(r.config.url);
      if (r.config.headers) setShowAdvanced(true);
    });
  }, []);

  const body = () => ({ kind, url, token: token || null, headers: showAdvanced ? headers || null : null });

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post("/api/admin/runtime/test", body()));
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
      toast({ kind: "success", message: "Runtime saved. New questions use it right away." });
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-md font-semibold text-ink">Model runtime</h2>
            <p className="text-sm text-muted">The GPU server that runs the models. This app never runs a model itself.</p>
          </div>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Type" htmlFor="rt-kind">
            <select id="rt-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="ollama">Ollama (Modal, Kaggle or the school box): can download models</option>
              <option value="openai">OpenAI-compatible (vLLM, llama.cpp): models fixed on the server</option>
              <option value="fake">Offline demo: canned answers, no GPU (for walkthroughs)</option>
            </select>
          </Field>
          <Field label="URL" htmlFor="rt-url" hint="e.g. https://your-name--localschool-ollama-serve.modal.run or http://localschool-box.local:11434">
            <input id="rt-url" className="input font-mono text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required={kind !== "fake"} disabled={kind === "fake"} />
          </Field>
          <Field label="Access token" htmlFor="rt-token" hint={cfg.has_token ? `Saved (${cfg.token}). Leave blank to keep it.` : "Optional. Sent as a Bearer token."}>
            <input id="rt-token" className="input font-mono text-sm" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg.has_token ? "••••••••" : "Optional"} />
          </Field>
          <div>
            <button type="button" className="text-sm font-medium text-muted hover:text-ink" onClick={() => setShowAdvanced((s) => !s)}>
              {showAdvanced ? "Hide" : "Show"} advanced headers
            </button>
            {showAdvanced && (
              <div className="mt-3">
                <Field label="Extra headers (JSON)" htmlFor="rt-headers" hint={cfg.headers ? `Saved: ${cfg.headers}. Leave blank to keep.` : 'For Modal proxy auth: {"Modal-Key": "wk-…", "Modal-Secret": "ws-…"}'}>
                  <textarea id="rt-headers" className="input h-20 resize-y py-2 font-mono text-sm" value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"Modal-Key": "…", "Modal-Secret": "…"}' />
                </Field>
              </div>
            )}
          </div>

          {result && (
            <div className={clsx("rounded-lg border px-4 py-3 text-sm", result.health.ok ? "border-success/25 bg-success/[0.05]" : "border-danger/25 bg-danger/[0.04]")}>
              <div className="flex items-center gap-2 font-medium">
                <Dot tone={result.health.ok ? "success" : "danger"} />
                <span className={result.health.ok ? "text-success" : "text-danger"}>{result.health.ok ? "Connected" : "Couldn't connect"}</span>
                {result.health.ok && (
                  <span className="font-normal text-muted">
                    · {result.health.latency_ms} ms{result.health.version && ` · Ollama ${result.health.version}`} · {result.models.length} model{result.models.length === 1 ? "" : "s"} installed
                  </span>
                )}
              </div>
              {!result.health.ok && <p className="mt-1 text-muted">{result.health.error}</p>}
              {result.health.ok && !result.is_local && <p className="mt-1 text-muted">This runtime is outside the school network, so the app shows a "synthetic data only" banner.</p>}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn-secondary" onClick={test} disabled={testing || (!url && kind !== "fake")}>
              {testing ? <Spinner /> : <Plug className="h-4 w-4" />} Test connection
            </button>
            <button className="btn-primary" disabled={saving || (!url && kind !== "fake")}>
              {saving && <Spinner />} Save
            </button>
          </div>
        </form>
      </section>

      <aside className="space-y-3 text-sm">
        <div className="eyebrow">Where the GPU lives</div>
        {[
          { title: "Modal (pilot)", body: "Free monthly credits; scales to zero when idle. Deploy deploy/modal/ollama_app.py, paste the URL and proxy-auth headers." },
          { title: "Kaggle notebook ($0 demo)", body: "Run deploy/kaggle/runtime.ipynb, paste the tunnel URL it prints. Sessions last ≤12 hours." },
          { title: "School box (production)", body: "Any NVIDIA PC or Mac with Ollama on the LAN. Real student data only goes here." },
        ].map((x) => (
          <div key={x.title} className="rounded-lg border border-line px-4 py-3">
            <div className="font-medium text-ink">{x.title}</div>
            <p className="mt-0.5 text-muted">{x.body}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- Models */

interface ModelsData {
  installed: ModelInfo[];
  error: string;
  active: { chat: string; embed: string };
  presets: { chat?: Preset[]; embed?: Preset[] };
  pulls: PullState[];
  capabilities: { pull: boolean; delete: boolean };
  index: { model: string; total_chunks: number; embedded_chunks: number; ready: boolean };
}

function ModelsTab() {
  const toast = useToast();
  const { refresh } = useStatus();
  const [data, setData] = useState<ModelsData | null>(null);
  const [custom, setCustom] = useState("");

  const load = useCallback(() => {
    api.get<ModelsData>("/api/admin/models").then(setData).catch((e) => toast({ kind: "error", message: e.message }));
  }, [toast]);
  useEffect(load, [load]);

  const pulling = data?.pulls.some((p) => !p.done);
  const indexing = data && !data.index.ready;
  useEffect(() => {
    if (!pulling && !indexing) return;
    const t = window.setInterval(load, 1500);
    return () => window.clearInterval(t);
  }, [pulling, indexing, load]);

  async function pull(model: string) {
    try {
      await api.post("/api/admin/models/pull", { model });
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }
  async function activate(role: "chat" | "embed", model: string) {
    try {
      await api.put("/api/admin/models/active", { role, model });
      toast({
        kind: "success",
        message: role === "embed" ? `Embedding model set to ${model}. Re-indexing your library in the background.` : `${model} now answers questions.`,
      });
      load();
      refresh();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }
  async function remove(model: string) {
    try {
      await api.del(`/api/admin/models/${encodeURIComponent(model)}`);
      toast({ kind: "success", message: `Removed ${model} from the runtime.` });
      load();
    } catch (e) {
      toast({ kind: "error", message: (e as Error).message });
    }
  }

  if (!data) return <Skeleton className="h-96 w-full" />;
  const installed = new Set(data.installed.flatMap((m) => [m.name, m.name.replace(/:latest$/, "")]));
  const activePulls = data.pulls.filter((p) => !p.done || p.error);

  return (
    <div className="space-y-6">
      {data.error && (
        <div className="rounded-lg border border-danger/25 bg-danger/[0.04] px-4 py-3 text-sm">
          <span className="font-medium text-danger">Runtime unreachable.</span> <span className="text-muted">{data.error}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(["chat", "embed"] as const).map((role) => (
          <section key={role} className="card p-5">
            <div className="eyebrow">{role === "chat" ? "Answers questions" : "Indexes documents"}</div>
            <div className="mt-2 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-faint" />
              <span className="font-mono text-md text-ink">{data.active[role]}</span>
              {!installed.has(data.active[role]) && !data.error && <Badge tone="warning">Not installed</Badge>}
            </div>
            {data.installed.length > 0 && (
              <select
                className="input mt-4"
                aria-label={`Active ${role} model`}
                value={installed.has(data.active[role]) ? data.active[role] : ""}
                onChange={(e) => e.target.value && activate(role, e.target.value)}
              >
                <option value="">Choose an installed model…</option>
                {data.installed.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.parameter_size && ` · ${m.parameter_size}`}
                  </option>
                ))}
              </select>
            )}
            {role === "embed" && data.index.total_chunks > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-faint">
                  <span>{data.index.ready ? "Library fully indexed" : "Re-indexing library"}</span>
                  <span className="tabular-nums">
                    {data.index.embedded_chunks}/{data.index.total_chunks}
                  </span>
                </div>
                <Progress value={(100 * data.index.embedded_chunks) / data.index.total_chunks} />
              </div>
            )}
          </section>
        ))}
      </div>

      {data.capabilities.pull && (
        <section className="card p-5">
          <h2 className="text-md font-semibold text-ink">Add a model</h2>
          <p className="mt-0.5 text-sm text-muted">Downloads onto the runtime's GPU storage. Large models take a few minutes; you can leave this page.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(["chat", "embed"] as const).flatMap((role) =>
              (data.presets[role] ?? []).map((p) => {
                const have = installed.has(p.name);
                const isActive = data.active[role] === p.name;
                return (
                  <div key={`${role}-${p.name}`} className="flex items-start justify-between gap-3 rounded-lg border border-line px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-ink">{p.name}</span>
                        <Badge>{role === "chat" ? p.label : `Embed · ${p.label}`}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{p.note}</p>
                    </div>
                    {isActive ? (
                      <Badge tone="accent">Active</Badge>
                    ) : have ? (
                      <button className="btn-secondary h-7 shrink-0" onClick={() => activate(role, p.name)}>
                        Use
                      </button>
                    ) : (
                      <button className="btn-secondary h-7 shrink-0" onClick={() => pull(p.name)} disabled={data.pulls.some((x) => x.model === p.name && !x.done)}>
                        <Download className="h-3.5 w-3.5" /> Pull
                      </button>
                    )}
                  </div>
                );
              }),
            )}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) pull(custom.trim());
              setCustom("");
            }}
          >
            <input className="input font-mono text-sm" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Any Ollama model tag, e.g. llama3.1:8b" aria-label="Model tag" />
            <button className="btn-secondary shrink-0" disabled={!custom.trim()}>
              <Download className="h-4 w-4" /> Pull
            </button>
          </form>

          {activePulls.length > 0 && (
            <ul className="mt-4 space-y-3">
              {activePulls.map((p) => (
                <li key={p.model} className="rounded-lg border border-line px-4 py-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-mono text-ink">{p.model}</span>
                    <span className={clsx("text-xs", p.error ? "text-danger" : "text-faint")}>
                      {p.error || `${p.status}${p.total ? ` · ${formatBytes(p.completed)} of ${formatBytes(p.total)}` : ""}`}
                    </span>
                  </div>
                  {!p.error && <Progress value={p.percent} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-md font-semibold text-ink">Installed on the runtime</h2>
        </div>
        {data.installed.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">{data.error ? "Connect the runtime to see its models." : "No models yet. Pull one above."}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {data.installed.map((m) => {
                const inUse = Object.values(data.active).some((a) => a === m.name || `${a}:latest` === m.name);
                return (
                  <tr key={m.name} className="group">
                    <td className="px-5 py-3 font-mono text-ink">{m.name}</td>
                    <td className="px-5 py-3 text-muted">{[m.family, m.parameter_size, m.quantization].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-5 py-3 tabular-nums text-muted">{formatBytes(m.size_bytes)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {m.loaded && <Badge tone="success">In GPU memory</Badge>}
                        {inUse && <Badge tone="accent">Active</Badge>}
                        {data.capabilities.delete && !inUse && (
                          <button className="btn-ghost h-7 w-7 px-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" onClick={() => remove(m.name)} aria-label={`Remove ${m.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- People */

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  section_count: number;
}

function PeopleTab() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "teacher", password: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<{ users: UserRow[] }>("/api/admin/users").then((r) => setUsers(r.users));
  }, []);
  useEffect(load, [load]);

  async function add() {
    setSaving(true);
    try {
      await api.post("/api/admin/users", form);
      toast({ kind: "success", message: `Added ${form.name || form.email}.` });
      setForm({ name: "", email: "", role: "teacher", password: "" });
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
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="card overflow-hidden">
        {!users ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-2.5 font-medium text-faint">Name</th>
                <th className="px-5 py-2.5 font-medium text-faint">Role</th>
                <th className="px-5 py-2.5 font-medium text-faint">Sections</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id} className="group">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="text-xs text-faint">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={u.role === "admin" ? "accent" : "neutral"}>{u.role}</Badge>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted">{u.section_count}</td>
                  <td className="px-3 py-3 text-right">
                    {u.id !== me?.id && (
                      <button className="btn-ghost h-7 w-7 px-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" onClick={() => remove(u)} aria-label={`Remove ${u.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card h-fit p-5">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-faint" />
          <h2 className="text-md font-semibold text-ink">Add a person</h2>
        </div>
        <p className="mt-1 text-xs text-faint">Teachers see only the roster sections imported under their email.</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Name" htmlFor="u-name">
            <input id="u-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="u-email">
            <input id="u-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Role" htmlFor="u-role">
            <select id="u-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Temporary password" htmlFor="u-pass" hint="At least 8 characters.">
            <input id="u-pass" type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
          </Field>
          <button className="btn-primary w-full" disabled={saving}>
            {saving && <Spinner />} Add person
          </button>
        </form>
      </section>
    </div>
  );
}
