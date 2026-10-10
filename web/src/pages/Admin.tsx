import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Plug, Trash2 } from "lucide-react";
import { api, formatBytes } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStatus } from "../lib/status";
import type { ModelInfo, Preset, PullState, RuntimeConfigPublic, RuntimeHealth } from "../lib/types";
import { useToast } from "../components/Toaster";
import { Skeleton, Spinner } from "../components/ui";
import {
  Bar,
  Callout,
  Chip,
  ConfirmDialog,
  CopyButton,
  DetailList,
  Frame,
  Label,
  Monogram,
  RailSection,
  SettingsGroup,
  SettingsRow,
  StatusDot,
  StatusText,
  Steps,
  Tabs,
  WorkspaceHeader,
  WorkspacePage,
  linkClass,
} from "../components/workspace/primitives";

type Tab = "runtime" | "models" | "people" | "macs";

export function Admin() {
  const [tab, setTab] = useState<Tab>("runtime");
  return (
    <WorkspacePage>
      <WorkspaceHeader title="Admin" description="Connect the model runtime, choose which models answer, and manage who can sign in." />
      <div className="mt-6 border-b border-line">
        <Tabs
          label="Admin sections"
          value={tab}
          onChange={setTab}
          items={[
            { id: "runtime", label: "Runtime" },
            { id: "models", label: "Models" },
            { id: "people", label: "People" },
            { id: "macs", label: "Teacher Macs" },
          ]}
        />
      </div>
      <div className="mt-8" role="tabpanel">
        {tab === "runtime" && <RuntimeTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "people" && <PeopleTab />}
        {tab === "macs" && <TeacherMacs />}
      </div>
    </WorkspacePage>
  );
}

/* ---------------------------------------------------------------- Runtime */

const KINDS = [
  { id: "ollama", title: "Ollama", body: "Modal, Kaggle or the school box. Can download models." },
  { id: "openai", title: "OpenAI-compatible", body: "vLLM or llama.cpp. Models are fixed on the server." },
  { id: "fake", title: "Offline demo", body: "Canned answers, no GPU. For walkthroughs." },
];

function since(epochSeconds: number | null) {
  if (!epochSeconds) return "never";
  const s = Math.max(0, Math.round(Date.now() / 1000 - epochSeconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function RuntimeTab() {
  const toast = useToast();
  const { status, refresh } = useStatus();
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

  if (!cfg) return <Skeleton className="h-[520px] w-full rounded-[2px]" />;

  const state = result ? (result.health.ok ? "connected" : "unreachable") : status?.runtime.state ?? "idle";
  const tone = state === "connected" ? "success" : state === "unreachable" ? "danger" : "warning";
  const stateLabel = state === "connected" ? "Connected" : state === "unreachable" ? "Unreachable" : "Idle";
  const isLocal = result ? result.is_local : cfg.is_local;
  const host = (() => {
    try {
      return cfg.url ? new URL(cfg.url).host : "";
    } catch {
      return cfg.url;
    }
  })();

  const rail = (
    <>
      <RailSection label="Where the GPU lives">
        <Steps
          items={[
            { title: "Modal (pilot)", body: "Free monthly credits; sleeps when idle. Run the “Deploy Modal runtime” GitHub Action, then paste its URL and your LS_RUNTIME_TOKEN." },
            { title: "Kaggle notebook ($0 demo)", body: "Run deploy/kaggle/runtime.ipynb and paste the tunnel URL it prints. Sessions last up to 12 hours." },
            { title: "School box (production)", body: "Any NVIDIA PC or Mac with Ollama on the LAN. Real student data only goes here." },
          ]}
        />
      </RailSection>
      <RailSection label="Privacy">
        <p className="text-[13px] leading-5 text-muted">This app never runs a model itself. It sends questions and passages only to the runtime you connect here.</p>
      </RailSection>
    </>
  );

  return (
    <Frame rail={rail} railWidth={300}>
      {/* Health */}
      <section className="border-b border-line px-5 py-6 sm:px-6" aria-label="Runtime status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="mb-1.5">Runtime status</Label>
            <div className="flex items-center gap-2.5">
              <StatusDot tone={tone} pulse={state === "connected"} />
              <h2 className="text-[19px] font-normal leading-7 text-ink">{stateLabel}</h2>
              <StatusText tone={isLocal ? "success" : "warning"}>{isLocal ? "School network" : "Outside network"}</StatusText>
            </div>
            <p className="mt-0.5 font-mono text-[12px] text-faint">{cfg.kind === "fake" ? "offline demo runtime" : host || "no URL set"}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={test} disabled={testing || (!url && kind !== "fake")}>
            {testing ? <Spinner /> : <Plug className="h-4 w-4" aria-hidden />} Test connection
          </button>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[13px] text-faint">Latency</dt>
            <dd className="mt-0.5 font-mono text-[20px] leading-7 text-ink">
              {result?.health.ok && result.health.latency_ms != null ? (
                <>
                  {result.health.latency_ms}
                  <span className="ml-1 text-[13px] text-faint">ms</span>
                </>
              ) : (
                <span className="text-faint">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-faint">Last reached</dt>
            <dd className="mt-0.5 font-mono text-[15px] leading-7 text-ink">{since(status?.runtime.last_ok ?? null)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[13px] text-faint">Answers with</dt>
            <dd className="mt-0.5 truncate font-mono text-[13px] leading-7 text-ink">{status?.models.chat ?? "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[13px] text-faint">Queue</dt>
            <dd className="mt-0.5 font-mono text-[15px] leading-7 text-ink">
              {status?.queue.waiting ?? 0}
              <span className="ml-1 font-sans text-[13px] text-faint">waiting</span>
            </dd>
          </div>
        </dl>
        {result && (
          <div className="mt-5">
            {result.health.ok ? (
              <Callout tone="success" title="Connected">
                <span className="font-mono text-[12px]">
                  {result.health.latency_ms} ms{result.health.version && ` · Ollama ${result.health.version}`} · {result.models.length} model{result.models.length === 1 ? "" : "s"} installed
                </span>
                {!result.is_local && <div className="mt-1">This runtime is outside the school network, so the app shows a “synthetic data only” banner.</div>}
              </Callout>
            ) : (
              <Callout tone="danger" title="Couldn't connect">
                {result.health.error}
              </Callout>
            )}
          </div>
        )}
        {!result && state === "unreachable" && status?.runtime.error && <p className="mt-4 text-[13px] text-danger">{status.runtime.error}</p>}
      </section>

      {/* Connection settings */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="px-5 pt-6 sm:px-6">
          <Label className="mb-1.5">Connection</Label>
          <h2 className="text-[19px] font-normal leading-7 text-ink">Model runtime</h2>
          <p className="mt-0.5 text-sm text-muted">The GPU server that runs the models.</p>
        </div>
        <div className="divide-y divide-line px-5 sm:px-6">
          <SettingsRow label="Type" hint="How the app talks to the runtime." align="start">
            <div role="radiogroup" aria-label="Runtime type" className="grid border border-line">
              {KINDS.map((k, i) => {
                const on = kind === k.id;
                return (
                  <label
                    key={k.id}
                    className={clsx(
                      "relative cursor-pointer px-3.5 py-3 transition-colors duration-150",
                      i > 0 && "border-t border-line",
                      on ? "bg-subtle" : "hover:bg-bg",
                    )}
                  >
                    <input type="radio" name="rt-kind" value={k.id} checked={on} onChange={() => setKind(k.id)} className="sr-only" />
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink">
                      <span className={clsx("flex h-3.5 w-3.5 translate-y-[2px] shrink-0 items-center justify-center rounded-full border", on ? "border-ink" : "border-line-strong")} aria-hidden>
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                      </span>
                      {k.title}
                      <span className="basis-full pl-[22px] text-[13px] text-faint sm:basis-auto sm:pl-0">{k.body}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </SettingsRow>
          <SettingsRow label="URL" htmlFor="rt-url" hint="Where the runtime listens." align="start">
            <input id="rt-url" className="input font-mono text-[13px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required={kind !== "fake"} disabled={kind === "fake"} />
            <p className="mt-1.5 break-all font-mono text-[11px] leading-4 text-faint">e.g. https://your-name--localschool-ollama-serve.modal.run or http://localschool-box.local:11434</p>
          </SettingsRow>
          <SettingsRow
            label="Access token"
            htmlFor="rt-token"
            hint={cfg.has_token ? "Saved. Leave blank to keep it." : "For Modal or a tunnel: your LS_RUNTIME_TOKEN, sent as a Bearer token."}
            align="start"
          >
            <input id="rt-token" className="input font-mono text-[13px]" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg.has_token ? "••••••••" : "Optional"} />
            {cfg.has_token && <p className="mt-1.5 font-mono text-[11px] text-faint">Saved: {cfg.token}</p>}
          </SettingsRow>
          <SettingsRow label="Extra headers" htmlFor="rt-headers" hint="Rarely needed. Extra HTTP headers as JSON." align="start">
            {showAdvanced ? (
              <>
                <textarea id="rt-headers" className="input h-20 resize-y py-2 font-mono text-[13px]" value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{"X-Api-Key": "…"}' />
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-[11px] text-faint">{cfg.headers ? `Saved: ${cfg.headers}. Leave blank to keep.` : ""}</span>
                  <button type="button" className={linkClass} onClick={() => setShowAdvanced(false)}>
                    Hide
                  </button>
                </div>
              </>
            ) : (
              <div className="flex h-9 items-center justify-between border border-line bg-panel px-3 text-sm">
                <span className="text-faint">{cfg.headers ? "Custom headers saved" : "None"}</span>
                <button type="button" className={linkClass} onClick={() => setShowAdvanced(true)}>
                  Change
                </button>
              </div>
            )}
          </SettingsRow>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
          <span className="mr-auto hidden text-[13px] text-faint sm:block">New questions use the saved runtime right away.</span>
          <button type="button" className="btn-secondary" onClick={test} disabled={testing || (!url && kind !== "fake")}>
            {testing ? <Spinner /> : <Plug className="h-4 w-4" aria-hidden />} Test
          </button>
          <button className="btn-primary" disabled={saving || (!url && kind !== "fake")}>
            {saving && <Spinner />} Save runtime
          </button>
        </div>
      </form>
    </Frame>
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
  const [confirm, setConfirm] = useState<string | null>(null);

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

  if (!data) return <Skeleton className="h-96 w-full rounded-[2px]" />;
  const installed = new Set(data.installed.flatMap((m) => [m.name, m.name.replace(/:latest$/, "")]));
  const activePulls = data.pulls.filter((p) => !p.done || p.error);
  const idxPct = data.index.total_chunks ? (100 * data.index.embedded_chunks) / data.index.total_chunks : 100;

  const roles = [
    { role: "chat" as const, label: "Answers questions", hint: "The chat model that writes every answer and citation." },
    { role: "embed" as const, label: "Indexes documents", hint: "The embedding model behind meaning-based search. Changing it re-indexes the library." },
  ];

  return (
    <div className="space-y-6">
      {data.error && (
        <Callout tone="danger" title="Runtime unreachable">
          {data.error}
        </Callout>
      )}

      <SettingsGroup label="Model roles" title="Which models do the work" description="Pick from the models installed on the runtime.">
        {roles.map(({ role, label, hint }) => (
          <SettingsRow key={role} label={label} hint={hint} htmlFor={`model-${role}`} align="start">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {data.installed.length > 0 ? (
                <select
                  id={`model-${role}`}
                  className="input font-mono text-[13px] sm:max-w-[360px]"
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
              ) : (
                <span className="flex h-9 items-center border border-line bg-bg px-3 font-mono text-[13px] text-ink sm:min-w-[280px]">{data.active[role]}</span>
              )}
              {!installed.has(data.active[role]) && !data.error ? (
                <StatusText tone="warning">Not installed</StatusText>
              ) : installed.has(data.active[role]) ? (
                <StatusText tone="success">Active</StatusText>
              ) : null}
            </div>
            {!installed.has(data.active[role]) && data.installed.length > 0 && (
              <p className="mt-1.5 text-xs text-faint">
                Configured: <span className="font-mono">{data.active[role]}</span>
              </p>
            )}
            {role === "embed" && data.index.total_chunks > 0 && (
              <div className="mt-4 max-w-[480px]">
                <div className="mb-1.5 flex items-center justify-between text-xs text-faint">
                  <StatusText tone={data.index.ready ? "success" : "warning"}>{data.index.ready ? "Library indexed" : "Re-indexing"}</StatusText>
                  <span className="font-mono">
                    {data.index.embedded_chunks}/{data.index.total_chunks}
                  </span>
                </div>
                <Bar value={idxPct} tone={data.index.ready ? "success" : "ink"} />
              </div>
            )}
          </SettingsRow>
        ))}
      </SettingsGroup>

      {data.capabilities.pull && (
        <section className="border border-line bg-panel">
          <div className="px-5 pb-4 pt-6 sm:px-6">
            <Label className="mb-1.5">Add a model</Label>
            <h2 className="text-[19px] font-normal leading-7 text-ink">Download onto the runtime</h2>
            <p className="mt-0.5 text-sm text-muted">Large models take a few minutes. You can leave this page.</p>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {(["chat", "embed"] as const).flatMap((role) =>
              (data.presets[role] ?? []).map((p) => {
                const have = installed.has(p.name);
                const isActive = data.active[role] === p.name;
                return (
                  <li key={`${role}-${p.name}`} className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] text-ink">{p.name}</span>
                        <Chip>{role === "chat" ? p.label : `Embed · ${p.label}`}</Chip>
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">{p.note}</p>
                    </div>
                    {isActive ? (
                      <StatusText tone="success">Active</StatusText>
                    ) : have ? (
                      <button className="btn-secondary shrink-0" onClick={() => activate(role, p.name)}>
                        Use
                      </button>
                    ) : (
                      <button className="btn-secondary shrink-0" onClick={() => pull(p.name)} disabled={data.pulls.some((x) => x.model === p.name && !x.done)}>
                        <Download className="h-3.5 w-3.5" aria-hidden /> Pull
                      </button>
                    )}
                  </li>
                );
              }),
            )}
          </ul>
          <form
            className="flex gap-2 border-t border-line px-5 py-4 sm:px-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) pull(custom.trim());
              setCustom("");
            }}
          >
            <input className="input font-mono text-[13px]" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Any Ollama model tag, e.g. llama3.1:8b" aria-label="Model tag" />
            <button className="btn-secondary shrink-0" disabled={!custom.trim()}>
              <Download className="h-4 w-4" aria-hidden /> Pull
            </button>
          </form>

          {activePulls.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {activePulls.map((p) => (
                <li key={p.model} className="px-5 py-3.5 sm:px-6">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono text-[13px] text-ink">{p.model}</span>
                    {p.error ? (
                      <StatusText tone="danger" title={p.error}>
                        Failed
                      </StatusText>
                    ) : (
                      <span className="font-mono text-[12px] text-faint">
                        {p.status}
                        {p.total ? ` · ${formatBytes(p.completed)} / ${formatBytes(p.total)}` : ""}
                      </span>
                    )}
                  </div>
                  {p.error ? <p className="text-[13px] text-danger">{p.error}</p> : <Bar value={p.percent} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="border border-line bg-panel">
        <div className="px-5 pb-4 pt-6 sm:px-6">
          <Label className="mb-1.5">Installed on the runtime</Label>
          <h2 className="text-[19px] font-normal leading-7 text-ink">
            <span className="font-mono">{data.installed.length}</span> {data.installed.length === 1 ? "model" : "models"}
          </h2>
        </div>
        {data.installed.length === 0 ? (
          <p className="border-t border-line px-6 py-6 text-sm text-faint">{data.error ? "Connect the runtime to see its models." : "No models yet. Pull one above."}</p>
        ) : (
          <div className="relative overflow-x-auto border-t border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-faint">
                  <th className="px-6 py-2.5 font-normal">Model</th>
                  <th className="px-3 py-2.5 font-normal">Details</th>
                  <th className="px-3 py-2.5 text-right font-normal">Size</th>
                  <th className="px-6 py-2.5 text-right font-normal">
                    <span className="sr-only">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.installed.map((m) => {
                  const inUse = Object.values(data.active).some((a) => a === m.name || `${a}:latest` === m.name);
                  return (
                    <tr key={m.name} className="group transition-colors hover:bg-bg">
                      <td className="px-6 py-3 font-mono text-[13px] text-ink">{m.name}</td>
                      <td className="px-3 py-3 text-[13px] text-muted">{[m.family, m.parameter_size, m.quantization].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-3 text-right font-mono text-[13px] text-muted">{formatBytes(m.size_bytes)}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {m.loaded && <StatusText tone="neutral">In GPU memory</StatusText>}
                          {inUse && <StatusText tone="success">Active</StatusText>}
                          {data.capabilities.delete && !inUse && (
                            <button className="btn-ghost h-7 w-7 px-0 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100" onClick={() => setConfirm(m.name)} aria-label={`Remove ${m.name}`}>
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        kicker="Remove model"
        title={<>Remove <span className="font-mono text-[17px]">{confirm}</span>?</>}
        body="It's deleted from the runtime's GPU storage. You can pull it again later, which takes a few minutes."
        confirmLabel="Remove model"
        onConfirm={() => {
          if (confirm) remove(confirm);
          setConfirm(null);
        }}
      />
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
  const [confirm, setConfirm] = useState<UserRow | null>(null);

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

  const field = "mb-1.5 block text-sm font-medium text-ink";
  const rail = (
    <RailSection label="Add a person">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div>
          <label className={field} htmlFor="u-name">
            Name
          </label>
          <input id="u-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={field} htmlFor="u-email">
            Email
          </label>
          <input id="u-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div>
          <label className={field} htmlFor="u-role">
            Role
          </label>
          <select id="u-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className={field} htmlFor="u-pass">
            Temporary password
          </label>
          <input id="u-pass" type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
          <p className="mt-1.5 text-xs text-faint">At least 8 characters.</p>
        </div>
        <button className="btn-primary w-full" disabled={saving}>
          {saving && <Spinner />} Add person
        </button>
        <p className="text-[13px] leading-5 text-faint">Teachers see only the roster sections imported under their email.</p>
      </form>
    </RailSection>
  );

  return (
    <Frame rail={rail} railWidth={320}>
      <div className="px-5 pb-4 pt-6 sm:px-6">
        <Label className="mb-1.5">People</Label>
        <h2 className="text-[19px] font-normal leading-7 text-ink">
          {users ? (
            <>
              <span className="font-mono">{users.length}</span> {users.length === 1 ? "person" : "people"} can sign in
            </>
          ) : (
            "Who can sign in"
          )}
        </h2>
      </div>
      {!users ? (
        <div className="divide-y divide-line border-t border-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-3.5">
              <Skeleton className="h-7 w-7 rounded-[2px]" />
              <Skeleton className="h-3.5 w-48 rounded-[2px]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_96px_80px_40px] gap-3 border-b border-line px-6 py-2.5 text-xs text-faint sm:grid">
            <span>Name</span>
            <span>Role</span>
            <span className="text-right">Sections</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="ws-stagger divide-y divide-line">
            {users.map((u, i) => (
              <li key={u.id} style={{ ["--i" as string]: i }} className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-bg sm:grid-cols-[minmax(0,1fr)_96px_80px_40px] sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <Monogram name={u.name || u.email} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">
                      {u.name}
                      {u.id === me?.id && <span className="ml-1.5 text-xs text-faint">(you)</span>}
                    </div>
                    <div className="truncate font-mono text-[12px] text-faint">{u.email}</div>
                  </div>
                </div>
                <span>
                  <Chip className={u.role === "admin" ? "border-line-strong text-ink" : undefined}>{u.role === "admin" ? "Admin" : "Teacher"}</Chip>
                </span>
                <span className="hidden text-right font-mono text-[13px] text-muted sm:block">{u.section_count}</span>
                <span className="flex justify-end">
                  {u.id !== me?.id && (
                    <button className="btn-ghost h-7 w-7 px-0 transition-opacity hover:text-danger focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => setConfirm(u)} aria-label={`Remove ${u.name}`}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        kicker="Remove person"
        title={`Remove ${confirm?.name || confirm?.email}?`}
        body={
          <>
            <span className="font-mono text-[12px] text-ink">{confirm?.email}</span> can no longer sign in. Their roster sections stay and relink if you add them again with the same email.
          </>
        }
        confirmLabel="Remove person"
        onConfirm={() => {
          if (confirm) remove(confirm);
          setConfirm(null);
        }}
      />
    </Frame>
  );
}

/* ---------------------------------------------------------------- Teacher Macs */

/** One-line install for teacher Macs, served by this server (no Apple Developer ID needed). */
function TeacherMacs() {
  const [info, setInfo] = useState<{ mac_app_present: boolean; command: string; zip_location: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .get<{ mac_app_present: boolean; command: string; zip_location: string }>("/api/admin/install")
      .then(setInfo)
      .catch(() => setFailed(true));
  }, []);

  const rail = (
    <RailSection label="What happens">
      <Steps
        items={[
          { title: "Paste", body: "The teacher opens Terminal and pastes the command once." },
          { title: "Install", body: "The app installs and opens without a security prompt." },
          { title: "Connect", body: "It's already pointed at this server. The teacher just signs in." },
        ]}
      />
    </RailSection>
  );

  if (failed) return <Callout tone="neutral">The install command isn't available from this server.</Callout>;
  if (!info) return <Skeleton className="h-64 w-full rounded-[2px]" />;

  return (
    <Frame rail={rail} railWidth={300}>
      <div className="px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="mb-1.5">Teacher Macs</Label>
            <h2 className="text-[19px] font-normal leading-7 text-ink">Install with one command</h2>
            <p className="mt-0.5 max-w-xl text-sm text-muted">Teachers paste this into Terminal once. The app installs and is already connected to this server.</p>
          </div>
          {info.mac_app_present ? <StatusText tone="success">App ready</StatusText> : <StatusText tone="warning">App not uploaded</StatusText>}
        </div>

        {info.mac_app_present ? (
          <div className="mt-6">
            <Label className="mb-2">Install command</Label>
            <div className="flex flex-col border border-line bg-bg sm:flex-row sm:items-stretch">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-4 py-3 font-mono text-[13px] leading-6 text-ink [scrollbar-width:thin]">
                <span className="select-none text-faint">$ </span>
                {info.command}
              </code>
              <div className="flex items-center border-t border-line px-3 py-2 sm:border-l sm:border-t-0">
                <CopyButton text={info.command} className="w-full sm:w-auto" />
              </div>
            </div>
            <p className="mt-2 text-[13px] text-faint">Share it by email or through your device-management tool.</p>
          </div>
        ) : (
          <div className="mt-6">
            <DetailList
              items={[
                { label: "Upload", value: <span className="font-mono text-[12px]">LocalSchool-macOS.zip</span> },
                { label: "To", value: <span className="font-mono text-[12px]">{info.zip_location}</span> },
              ]}
            />
            <p className="mt-3 text-[13px] leading-5 text-muted">
              Get the zip from the “Desktop (macOS)” GitHub Action or a release, or re-run the server installer with <span className="font-mono text-[12px] text-ink">LS_APP_ZIP</span>.
            </p>
          </div>
        )}
      </div>
    </Frame>
  );
}
