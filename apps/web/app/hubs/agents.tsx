"use client";

/**
 * Settings → Agents: stored agent configs (docs/connectors.md) — the named
 * agents, their skills, connectors, schedules, and scoped tokens. Schedule
 * editing here is the owner-facing payoff of the scheduling inversion: no
 * more frozen scheduler prompts. Configs ship disabled; enabling one hands it
 * to the mini runner's agent-pass loop.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bot, ClipboardCopy, Pencil, Plus } from "lucide-react";
import { describeAgentSchedule } from "@skippy/shared";
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
} from "../components";
import {
  codeClass,
  formGridClass,
  itemClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
} from "../page-classes";
import { agentRoleDisplayName } from "../../lib/display";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

const EMPTY_FORM = {
  roleKey: "",
  displayName: "",
  skillSlugs: "",
  connectorSlugs: "",
  preferredHarness: "",
  scheduleKind: "manual",
  everyMinutes: "30",
  windowStart: "07:00",
  windowEnd: "22:00",
  timesOfDay: "06:30",
  timeZone: "America/New_York",
  mcpTokenId: "",
};

function formatWhen(timestamp: number | undefined): string {
  if (!timestamp) return "never";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scheduleFromForm(form: AnyRecord): AnyRecord | null {
  if (form.scheduleKind === "manual") return null;
  if (form.scheduleKind === "interval") {
    return {
      kind: "interval",
      everyMinutes: Number(form.everyMinutes),
      ...(form.windowStart.trim() && form.windowEnd.trim()
        ? { window: { start: form.windowStart.trim(), end: form.windowEnd.trim() } }
        : {}),
      ...(form.timeZone.trim() ? { timeZone: form.timeZone.trim() } : {}),
    };
  }
  return {
    kind: "daily",
    timesOfDay: form.timesOfDay
      .split(",")
      .map((time: string) => time.trim())
      .filter(Boolean),
    ...(form.timeZone.trim() ? { timeZone: form.timeZone.trim() } : {}),
  };
}

function formFromConfig(config: AnyRecord): AnyRecord {
  const schedule = config.schedule;
  return {
    roleKey: config.roleKey,
    displayName: config.displayName ?? "",
    skillSlugs: (config.skillSlugs ?? []).join(", "),
    connectorSlugs: (config.connectorSlugs ?? []).join(", "),
    preferredHarness: config.preferredHarness ?? "",
    scheduleKind: schedule?.kind ?? "manual",
    everyMinutes: String(schedule?.kind === "interval" ? schedule.everyMinutes : 30),
    windowStart: schedule?.kind === "interval" ? (schedule.window?.start ?? "") : "07:00",
    windowEnd: schedule?.kind === "interval" ? (schedule.window?.end ?? "") : "22:00",
    timesOfDay: schedule?.kind === "daily" ? schedule.timesOfDay.join(", ") : "06:30",
    timeZone: schedule?.timeZone ?? "America/New_York",
    mcpTokenId: config.token?._id ?? "",
  };
}

export function AgentsContent() {
  const viewerReady = useViewerReady();
  const configs = useQuery(api.agentConfigs.listForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const tokensData = useQuery(api.mcpTokens.list, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const upsert = useMutation(api.agentConfigs.upsertForViewer);
  const seedDefaults = useMutation(api.agentConfigs.seedDefaultsForViewer);
  const createToken = useMutation(api.mcpTokens.create);
  const toast = useToast();

  const [form, setForm] = useState<AnyRecord>(EMPTY_FORM);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Shown once, then gone — the server only stores a hash.
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const bindableTokens = useMemo(() => {
    if (!tokensData) return [] as AnyRecord[];
    return tokensData.filter(
      (token) => !token.revokedAt && (!token.role || !editingRole || token.role === editingRole || token.role === form.roleKey.trim()),
    );
  }, [tokensData, editingRole, form.roleKey]);

  const startEdit = (config: AnyRecord) => {
    setEditingRole(config.roleKey);
    setForm(formFromConfig(config));
  };

  const resetForm = () => {
    setEditingRole(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    const roleKey = form.roleKey.trim();
    if (!roleKey) {
      toast("Role key is required.", "error");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        roleKey,
        displayName: form.displayName.trim() || undefined,
        skillSlugs: form.skillSlugs
          .split(",")
          .map((slug: string) => slug.trim())
          .filter(Boolean),
        connectorSlugs: form.connectorSlugs
          .split(",")
          .map((slug: string) => slug.trim())
          .filter(Boolean),
        preferredHarness: form.preferredHarness ? form.preferredHarness : null,
        schedule: scheduleFromForm(form),
        mcpTokenId: form.mcpTokenId ? form.mcpTokenId : null,
      } as any);
      toast(editingRole ? "Agent updated." : "Agent created.", "success");
      resetForm();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save agent config", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (config: AnyRecord) => {
    try {
      const result = (await upsert({ roleKey: config.roleKey, enabled: !config.enabled } as any)) as {
        nextDueAt?: number;
      };
      toast(
        config.enabled
          ? `${config.displayName} disabled.`
          : `${config.displayName} enabled${result.nextDueAt ? ` — next pass ${formatWhen(result.nextDueAt)}` : ""}.`,
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update agent", "error");
    }
  };

  const seed = async () => {
    try {
      const result = (await seedDefaults({})) as { created: string[] };
      toast(
        result.created.length
          ? `Seeded (disabled): ${result.created.join(", ")}`
          : "Defaults already present.",
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not seed agents", "error");
    }
  };

  const mintScopedToken = async () => {
    const roleKey = form.roleKey.trim();
    if (!roleKey) {
      toast("Set the role key first.", "error");
      return;
    }
    try {
      const result = (await createToken({
        label: `${form.displayName.trim() || roleKey} (scoped)`,
        role: roleKey,
      } as any)) as { token: string; tokenId: string };
      setCreatedToken(result.token);
      setForm((current: AnyRecord) => ({ ...current, mcpTokenId: result.tokenId }));
      toast("Scoped token created and bound. Copy it now — it is only shown once.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create token", "error");
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    toast("Token copied.", "success");
  };

  return (
    <Card>
      <h2>Agents</h2>
      <p className={mutedClass} style={{ maxWidth: 640 }}>
        Named agents: skills for instructions, connectors for access, a schedule for cadence, and a
        role-scoped token for least privilege. Enabling an agent hands it to the Mac mini runner's
        agent-pass loop; the token's plaintext lives only in the runner's local config.
      </p>

      {configs === undefined ? (
        <LoadingRow label="Loading agents..." />
      ) : configs.length === 0 ? (
        <EmptyState icon={<Bot size={20} aria-hidden />} title="No agents configured">
          Seed the known roles (Agenda, Financial, Task, and a PM per active project) — all disabled
          until you enable them.
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => void seed()}>
              Seed default agents
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className={itemListClass} style={{ marginTop: 12 }}>
          {configs.map((config) => (
            <article className={itemClass} key={config._id}>
              <span className={itemIconClass}>
                <Bot size={17} aria-hidden />
              </span>
              <div>
                <p className={itemTitleClass}>
                  {config.displayName || agentRoleDisplayName(config.roleKey) || config.roleKey}
                </p>
                <p className={itemMetaClass}>
                  {config.roleKey}
                  {" · "}
                  {describeAgentSchedule(config.schedule)}
                  {config.connectorSlugs?.length ? ` · connectors: ${config.connectorSlugs.join(", ")}` : ""}
                  {config.token ? ` · token: ${config.token.label}` : " · no token bound"}
                </p>
                <p className={itemMetaClass}>
                  {config.enabled
                    ? `next pass ${formatWhen(config.nextDueAt)}`
                    : "disabled"}
                  {config.lastRunStartedAt
                    ? ` · last ran ${formatWhen(config.lastRunStartedAt)} (${config.lastRunStatus ?? "unknown"})`
                    : " · never run"}
                </p>
              </div>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <Badge tone={config.enabled ? "green" : "neutral"}>
                  {config.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Button small onClick={() => void toggleEnabled(config)}>
                  {config.enabled ? "Disable" : "Enable"}
                </Button>
                <Button small onClick={() => startEdit(config)}>
                  <Pencil size={13} aria-hidden /> Edit
                </Button>
              </span>
            </article>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>{editingRole ? `Edit agent: ${editingRole}` : "Add agent"}</h3>
      {createdToken ? (
        <p className={codeClass} style={{ marginTop: 8 }}>
          {createdToken}
          <Button small onClick={() => void copyToken()} style={{ marginLeft: 8 }}>
            <ClipboardCopy size={13} aria-hidden /> Copy
          </Button>
          <br />
          Paste this into the runner's local config. It is only shown once.
        </p>
      ) : null}
      <div className={formGridClass} style={{ marginTop: 8 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Role key">
            <TextInput
              value={form.roleKey}
              disabled={Boolean(editingRole)}
              onChange={(event) => setForm({ ...form, roleKey: event.target.value })}
              placeholder="agenda | finance | pm:{projectId}"
            />
          </Field>
          <Field label="Display name">
            <TextInput
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="Agenda Agent"
            />
          </Field>
          <Field label="Skills (comma-separated slugs)">
            <TextInput
              value={form.skillSlugs}
              onChange={(event) => setForm({ ...form, skillSlugs: event.target.value })}
              placeholder="harness-bootstrap, agenda-ingestion"
            />
          </Field>
          <Field label="Connectors (comma-separated slugs)">
            <TextInput
              value={form.connectorSlugs}
              onChange={(event) => setForm({ ...form, connectorSlugs: event.target.value })}
              placeholder="google, imessage"
            />
          </Field>
          <Field label="Harness">
            <Select
              value={form.preferredHarness}
              onChange={(event) => setForm({ ...form, preferredHarness: event.target.value })}
            >
              <option value="">Default</option>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </Select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Schedule">
            <Select
              value={form.scheduleKind}
              onChange={(event) => setForm({ ...form, scheduleKind: event.target.value })}
            >
              <option value="manual">Manual (no schedule)</option>
              <option value="interval">Interval</option>
              <option value="daily">Daily times</option>
            </Select>
          </Field>
          {form.scheduleKind === "interval" ? (
            <>
              <Field label="Every (minutes)">
                <TextInput
                  value={form.everyMinutes}
                  onChange={(event) => setForm({ ...form, everyMinutes: event.target.value })}
                  style={{ width: 90 }}
                />
              </Field>
              <Field label="Window start">
                <TextInput
                  value={form.windowStart}
                  onChange={(event) => setForm({ ...form, windowStart: event.target.value })}
                  placeholder="07:00"
                  style={{ width: 90 }}
                />
              </Field>
              <Field label="Window end">
                <TextInput
                  value={form.windowEnd}
                  onChange={(event) => setForm({ ...form, windowEnd: event.target.value })}
                  placeholder="22:00"
                  style={{ width: 90 }}
                />
              </Field>
            </>
          ) : null}
          {form.scheduleKind === "daily" ? (
            <Field label="Times (comma-separated HH:MM)">
              <TextInput
                value={form.timesOfDay}
                onChange={(event) => setForm({ ...form, timesOfDay: event.target.value })}
                placeholder="06:30, 23:30"
              />
            </Field>
          ) : null}
          {form.scheduleKind !== "manual" ? (
            <Field label="Time zone">
              <TextInput
                value={form.timeZone}
                onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
                placeholder="America/New_York"
              />
            </Field>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Scoped token">
            <Select
              value={form.mcpTokenId}
              onChange={(event) => setForm({ ...form, mcpTokenId: event.target.value })}
            >
              <option value="">None bound</option>
              {bindableTokens.map((token) => (
                <option value={token._id} key={token._id}>
                  {token.label} ({token.role ?? "full access"})
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => void mintScopedToken()} disabled={saving}>
            <Plus size={15} aria-hidden /> Mint scoped token
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {editingRole ? "Save changes" : "Add agent"}
          </Button>
          {editingRole ? (
            <Button onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
