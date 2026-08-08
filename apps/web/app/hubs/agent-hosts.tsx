"use client";

/**
 * Settings → Agent hosts: manage Mac mini runner hosts and per-project
 * execution mappings for the agent workbench (docs/mac-mini-agent-workbench.md).
 *
 * Host credentials follow the MCP-token pattern: the plaintext token is shown
 * exactly once at creation; only a hash is stored server-side.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ClipboardCopy, MonitorCog, Plus, X } from "lucide-react";
import { api } from "../../lib/skippy-api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingRow,
  Select,
  TextInput,
  useToast,
  type BadgeTone,
} from "../components";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

const HOST_STATUS_TONES: Record<string, BadgeTone> = {
  online: "green",
  draining: "gold",
  offline: "neutral",
};

function formatRelative(timestamp: number | undefined): string {
  if (!timestamp) return "never";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HostsSection() {
  const viewerReady = useViewerReady();
  const hosts = useQuery(api.agentWorkbench.listHostsForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const createHost = useMutation(api.agentWorkbench.createHostForViewer);
  const revokeHost = useMutation(api.agentWorkbench.revokeHostForViewer);
  const toast = useToast();

  const [displayName, setDisplayName] = useState("Mac mini");
  const [hostKey, setHostKey] = useState("mac-mini");
  const [creating, setCreating] = useState(false);
  // Shown once, then gone — the server only stores a hash.
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const create = async () => {
    if (!displayName.trim() || !hostKey.trim()) {
      toast("Display name and host key are required.", "error");
      return;
    }
    setCreating(true);
    try {
      const result = (await createHost({ displayName: displayName.trim(), hostKey: hostKey.trim() })) as {
        token: string;
      };
      setCreatedToken(result.token);
      toast("Host created. Copy the token now — it is only shown once.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create host", "error");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (host: AnyRecord) => {
    try {
      await revokeHost({ hostId: host._id });
      toast(`Host revoked: ${host.displayName}`, "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not revoke host", "error");
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    toast("Token copied.", "success");
  };

  return (
    <Card>
      <h2>Execution hosts</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Machines that run agent work (the always-on Mac mini). A host connects outbound-only with the token minted
        here, advertises which harnesses it supports, and claims queued runs. Revoking a token takes the host offline
        immediately.
      </p>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Display name">
            <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label="Host key">
            <TextInput
              value={hostKey}
              onChange={(event) => setHostKey(event.target.value)}
              placeholder="machine identifier"
            />
          </Field>
          <Button variant="primary" disabled={creating} onClick={() => void create()}>
            <Plus size={15} aria-hidden /> Create host
          </Button>
        </div>

        {createdToken ? (
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>One-time host token</p>
            <p className="code" style={{ margin: 0, wordBreak: "break-all" }}>
              {createdToken}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Store it as <span className="code">SKIPPY_RUNNER_HOST_TOKEN</span> on the runner machine. This full value
              is only returned once.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button small onClick={() => void copyToken()}>
                <ClipboardCopy size={14} aria-hidden /> Copy token
              </Button>
              <Button small variant="ghost" onClick={() => setCreatedToken(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}

        {hosts === undefined ? (
          <LoadingRow label="Loading hosts..." />
        ) : !hosts.length ? (
          <EmptyState icon={<MonitorCog size={20} aria-hidden />} title="No hosts yet">
            Create a host token, then start the runner on the Mac mini with it (see apps/runner/README.md).
          </EmptyState>
        ) : (
          <div className="item-list">
            {hosts.map((host) => (
              <article className="item" key={host._id}>
                <div>
                  <p className="item-title">
                    {host.displayName} <span className="muted">({host.hostKey})</span>
                  </p>
                  <p className="item-meta">
                    {host.tokenPrefix}... · heartbeat {formatRelative(host.lastHeartbeatAt)}
                    {host.capabilities?.harnesses?.length
                      ? ` · harnesses: ${host.capabilities.harnesses.join(", ")}`
                      : " · no harnesses registered yet"}
                    {host.capabilities?.maxConcurrency ? ` · concurrency ${host.capabilities.maxConcurrency}` : ""}
                  </p>
                </div>
                <Badge
                  tone={host.revokedAt ? "red" : (HOST_STATUS_TONES[host.status] ?? "neutral")}
                  dot={host.status === "online"}
                >
                  {host.revokedAt ? "Revoked" : host.status}
                </Badge>
                {!host.revokedAt ? (
                  <button className="icon-button" type="button" title="Revoke host" onClick={() => void revoke(host)}>
                    <X size={17} aria-hidden />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function ExecutionMappingsSection() {
  const viewerReady = useViewerReady();
  const configs = useQuery(api.agentWorkbench.listProjectExecutionConfigsForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const hosts = useQuery(api.agentWorkbench.listHostsForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const projects = useQuery(api.projects.activeProjectsForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const setConfig = useMutation(api.agentWorkbench.setProjectExecutionConfigForViewer);
  const toast = useToast();

  const [projectId, setProjectId] = useState("");
  const [hostId, setHostId] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [preferredHarness, setPreferredHarness] = useState<"claude" | "codex">("claude");
  const [saving, setSaving] = useState(false);

  const activeHosts = (hosts ?? []).filter((host) => !host.revokedAt);
  const codeProjects = (projects ?? []).filter((project) => project.kind === "code");
  const mappedProjectIds = new Set((configs ?? []).map((config) => config.projectId));

  const save = async () => {
    if (!projectId || !hostId || !localPath.trim()) {
      toast("Project, host, and local path are required.", "error");
      return;
    }
    setSaving(true);
    try {
      await setConfig({
        projectId: projectId as any,
        hostId: hostId as any,
        localPath: localPath.trim(),
        preferredHarness,
        enabled: true,
      });
      toast("Execution mapping saved.", "success");
      setProjectId("");
      setLocalPath("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save mapping", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (config: AnyRecord) => {
    try {
      await setConfig({
        projectId: config.projectId,
        hostId: config.hostId,
        localPath: config.localPath,
        enabled: !config.enabled,
      });
      toast(config.enabled ? "Mapping disabled." : "Mapping enabled.", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update mapping", "error");
    }
  };

  return (
    <Card>
      <h2>Project execution mappings</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Which host executes each code project, and where its allowlisted checkout lives on that machine. The Execute
        button on a project board only appears once its project is mapped to an online host.
      </p>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Project">
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} style={{ minWidth: 180 }}>
              <option value="">Select a code project…</option>
              {codeProjects.map((project) => (
                <option key={project._id} value={project._id}>
                  {project.title}
                  {mappedProjectIds.has(project._id) ? " (mapped)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Host">
            <Select value={hostId} onChange={(event) => setHostId(event.target.value)} style={{ minWidth: 150 }}>
              <option value="">Select a host…</option>
              {activeHosts.map((host) => (
                <option key={host._id} value={host._id}>
                  {host.displayName} ({host.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Local repo path on host">
            <TextInput
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder="/Users/skippy-runner/projects/my-repo"
              style={{ minWidth: 260 }}
            />
          </Field>
          <Field label="Preferred harness">
            <Select
              value={preferredHarness}
              onChange={(event) => setPreferredHarness(event.target.value as "claude" | "codex")}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </Select>
          </Field>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            Save mapping
          </Button>
        </div>

        {codeProjects.length === 0 && projects !== undefined ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No code projects found. Set a project&apos;s kind to “code” (with a repo URL) in its board settings first.
          </p>
        ) : null}

        {configs === undefined ? (
          <LoadingRow label="Loading mappings..." />
        ) : !configs.length ? null : (
          <div className="item-list">
            {configs.map((config) => (
              <article className="item" key={config._id}>
                <div>
                  <p className="item-title">{config.projectTitle}</p>
                  <p className="item-meta">
                    {config.hostDisplayName} ({config.hostStatus}) · <span className="code">{config.localPath}</span>
                    {config.preferredHarness ? ` · prefers ${config.preferredHarness}` : ""}
                    {config.requirePushApproval ? " · push requires approval" : ""}
                  </p>
                </div>
                <Badge tone={config.enabled ? "green" : "neutral"}>{config.enabled ? "Enabled" : "Disabled"}</Badge>
                <Button small variant="ghost" onClick={() => void toggleEnabled(config)}>
                  {config.enabled ? "Disable" : "Enable"}
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function AgentHostsContent() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <HostsSection />
      <ExecutionMappingsSection />
    </div>
  );
}
