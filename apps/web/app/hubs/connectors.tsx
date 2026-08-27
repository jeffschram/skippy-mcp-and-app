"use client";

/**
 * Settings → Connectors: the inventory of named access to external systems
 * (docs/connectors.md). Records are metadata only — credentials stay on the
 * providing host. Availability is live: a connector is usable when an online
 * host lists it in capabilities.connectors.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Cable, Pencil, Plus } from "lucide-react";
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
import {
  formGridClass,
  itemClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
} from "../page-classes";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "green",
  pending: "gold",
  retired: "neutral",
};

const KIND_LABELS: Record<string, string> = {
  local_mcp: "Local MCP server",
  local_data: "Local data access",
  http_feed: "HTTP feed",
};

const EMPTY_FORM = {
  slug: "",
  displayName: "",
  kind: "local_mcp",
  readOnly: true,
  status: "pending",
  docsPath: "",
  notes: "",
};

export function ConnectorsContent() {
  const viewerReady = useViewerReady();
  const connectors = useQuery(api.connectors.listForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const upsert = useMutation(api.connectors.upsertForViewer);
  const seedDefaults = useMutation(api.connectors.seedDefaultsForViewer);
  const toast = useToast();

  const [form, setForm] = useState<AnyRecord>(EMPTY_FORM);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (connector: AnyRecord) => {
    setEditingSlug(connector.slug);
    setForm({
      slug: connector.slug,
      displayName: connector.displayName,
      kind: connector.kind,
      readOnly: connector.readOnly,
      status: connector.status,
      docsPath: connector.docsPath ?? "",
      notes: connector.notes ?? "",
    });
  };

  const resetForm = () => {
    setEditingSlug(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    if (!form.slug.trim() || !form.displayName.trim()) {
      toast("Slug and display name are required.", "error");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        slug: form.slug,
        displayName: form.displayName,
        kind: form.kind,
        readOnly: Boolean(form.readOnly),
        status: form.status,
        ...(form.docsPath.trim() ? { docsPath: form.docsPath.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      } as any);
      toast(editingSlug ? "Connector updated." : "Connector created.", "success");
      resetForm();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save connector", "error");
    } finally {
      setSaving(false);
    }
  };

  const seed = async () => {
    try {
      const result = (await seedDefaults({})) as { created: string[] };
      toast(
        result.created.length ? `Seeded: ${result.created.join(", ")}` : "Defaults already present.",
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not seed connectors", "error");
    }
  };

  return (
    <Card>
      <h2>Connectors</h2>
      <p className={mutedClass} style={{ maxWidth: 640 }}>
        Named access to external systems — what Skippy's agents can touch. Records here are inventory only;
        OAuth tokens and API secrets stay on the providing host and never enter Skippy. A connector is
        available when an online agent host provides it.
      </p>

      {connectors === undefined ? (
        <LoadingRow label="Loading connectors..." />
      ) : connectors.length === 0 ? (
        <EmptyState icon={<Cable size={20} aria-hidden />} title="No connectors yet">
          Seed the known defaults (plaid, imessage, google) or add one below.
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => void seed()}>
              Seed default connectors
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className={itemListClass} style={{ marginTop: 12 }}>
          {connectors.map((connector) => (
            <article className={itemClass} key={connector._id}>
              <span className={itemIconClass}>
                <Cable size={17} aria-hidden />
              </span>
              <div>
                <p className={itemTitleClass}>{connector.displayName}</p>
                <p className={itemMetaClass}>
                  {connector.slug}
                  {" · "}
                  {KIND_LABELS[connector.kind] ?? connector.kind}
                  {connector.readOnly ? " · read-only" : " · read-write"}
                  {" · "}
                  {connector.providers.length === 0
                    ? "no host provides this"
                    : connector.providers
                        .map((provider: AnyRecord) => `${provider.displayName} (${provider.online ? "online" : "offline"})`)
                        .join(", ")}
                </p>
                {connector.notes ? <p className={itemMetaClass}>{connector.notes}</p> : null}
              </div>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <Badge tone={connector.available ? "green" : "neutral"}>
                  {connector.available ? "Available" : "Unavailable"}
                </Badge>
                <Badge tone={STATUS_TONES[connector.status] ?? "neutral"}>{connector.status}</Badge>
                <Button small onClick={() => startEdit(connector)}>
                  <Pencil size={13} aria-hidden /> Edit
                </Button>
              </span>
            </article>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>{editingSlug ? `Edit connector: ${editingSlug}` : "Add connector"}</h3>
      <div className={formGridClass} style={{ marginTop: 8 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Slug">
            <TextInput
              value={form.slug}
              disabled={Boolean(editingSlug)}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              placeholder="google"
            />
          </Field>
          <Field label="Display name">
            <TextInput
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="Google (Gmail + Calendar)"
            />
          </Field>
          <Field label="Kind">
            <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="local_mcp">Local MCP server</option>
              <option value="local_data">Local data access</option>
              <option value="http_feed">HTTP feed</option>
            </Select>
          </Field>
          <Field label="Access">
            <Select
              value={form.readOnly ? "read-only" : "read-write"}
              onChange={(event) => setForm({ ...form, readOnly: event.target.value === "read-only" })}
            >
              <option value="read-only">Read-only</option>
              <option value="read-write">Read-write</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </Select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Field label="Docs path (optional)">
            <TextInput
              value={form.docsPath}
              onChange={(event) => setForm({ ...form, docsPath: event.target.value })}
              placeholder="docs/google-source.md"
            />
          </Field>
          <Field label="Notes (optional, never secrets)">
            <TextInput
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Audit outcome, setup location…"
            />
          </Field>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            <Plus size={15} aria-hidden /> {editingSlug ? "Save changes" : "Add connector"}
          </Button>
          {editingSlug ? (
            <Button onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
