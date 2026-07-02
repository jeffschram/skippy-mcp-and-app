"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ClipboardCopy, Pencil, ScrollText } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { Badge, Button, Card, Dialog, EmptyState, Field, LoadingRow, TextArea, TextInput, useToast } from "../components";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

function copyText(text: string, toast: ReturnType<typeof useToast>) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast("Copied.", "success"))
    .catch(() => toast("Could not copy to clipboard", "error"));
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <pre
      className="code"
      style={{
        margin: 0,
        padding: 16,
        whiteSpace: "pre-wrap",
        lineHeight: 1.55,
        overflowX: "auto",
      }}
    >
      {text}
    </pre>
  );
}

export function SkillsListContent() {
  const skills = useQuery(api.skills.listSkills, {}) as AnyRecord[] | undefined;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Harness skills</p>
          <h1>Skills.</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Portable Skippy instructions that Codex, Claude, Hermes, or another harness can load without copy-paste drift.
          </p>
        </div>
      </div>

      {skills === undefined ? (
        <Card>
          <LoadingRow label="Loading skills..." />
        </Card>
      ) : skills.length === 0 ? (
        <Card>
          <EmptyState icon={<ScrollText size={22} aria-hidden />} title="No skills yet">
            Add portable harness skills for recurring workflows.
          </EmptyState>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {skills.map((skill) => (
            <Link key={skill.slug} className="item" href={`/skills/${skill.slug}`} style={{ gridTemplateColumns: "auto 1fr auto" }}>
              <span className="item-icon">
                <ScrollText size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{skill.title}</p>
                <p className="item-meta">{skill.description}</p>
              </div>
              <span className="project-row-side">
                <Badge tone={skill.isDefault ? "neutral" : "blue"}>v{skill.version}</Badge>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function SkillDetailContent({ slug }: { slug: string }) {
  const viewerReady = useViewerReady();
  const skill = useQuery(api.skills.getSkill, { slug }) as AnyRecord | null | undefined;
  const versions = useQuery(api.skills.listSkillVersions, { slug }) as AnyRecord[] | undefined;
  const saveSkill = useMutation(api.skills.saveSkillForViewer);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const publicSkillUrl = `https://skippy.jeffschram.dev/skills/${slug}`;
  const schedulerInstructions = [
    "If you support Skippy MCP prompts:",
    "Use the prompt `skippy_task_heartbeat`.",
    "",
    "If you do not support Skippy MCP prompts but do support Skippy MCP tools:",
    `Call \`get_skill\` with slug \`${slug}\``,
    "",
    "If neither of those work, load the Skippy skill at:",
    publicSkillUrl,
  ].join("\n");

  const openEditor = () => {
    if (!skill) return;
    setTitle(skill.title ?? "");
    setDescription(skill.description ?? "");
    setBody(skill.body ?? "");
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveSkill({
        slug,
        title,
        description,
        body,
        visibility: "public",
      });
      toast("Skill saved.", "success");
      setEditing(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save skill", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Skill</p>
          <h1>{skill?.title ?? "Skill"}</h1>
          {skill?.description ? <p className="muted" style={{ maxWidth: 640 }}>{skill.description}</p> : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="text-button compact" href="/skills">
            Skills
          </Link>
          {skill ? (
            <Button onClick={() => copyText(skill.body, toast)}>
              <ClipboardCopy size={16} aria-hidden /> Copy
            </Button>
          ) : null}
          {skill && viewerReady ? (
            <Button variant="primary" onClick={openEditor}>
              <Pencil size={16} aria-hidden /> Edit
            </Button>
          ) : null}
        </div>
      </div>

      {skill === undefined ? (
        <Card>
          <LoadingRow label="Loading skill..." />
        </Card>
      ) : skill === null ? (
        <Card>
          <EmptyState icon={<ScrollText size={22} aria-hidden />} title="Skill not found">
            This skill is not available.
          </EmptyState>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Badge tone="blue">{skill.slug}</Badge>
              <Badge tone="neutral">version {skill.version}</Badge>
              {skill.isDefault ? <Badge tone="gold">default</Badge> : null}
              <Badge tone="neutral">{skill.visibility}</Badge>
            </div>
            <MarkdownBlock text={skill.body} />
          </Card>
          <Card>
            <h2 style={{ marginTop: 0 }}>How to use this skill</h2>
            <p className="muted">
              Use this skill when you want an AI harness like Codex, Claude, or Hermes to periodically check Skippy
              for Ready agent tasks and report results back to Skippy.
            </p>
            <p className="muted">In your harness scheduler paste the following:</p>
            <TextArea
              aria-label="Harness scheduler instructions"
              readOnly
              value={schedulerInstructions}
              style={{ minHeight: 210, marginBottom: 12 }}
            />
            <p style={{ margin: 0 }}>
              <Button onClick={() => copyText(schedulerInstructions, toast)}>
                <ClipboardCopy size={16} aria-hidden /> Copy scheduler instructions
              </Button>
            </p>
          </Card>
          <Card>
            <h2 style={{ marginTop: 0 }}>Versions</h2>
            {versions === undefined ? (
              <LoadingRow label="Loading versions..." />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {versions.map((version) => (
                  <div
                    key={version._id ?? `${version.slug}-${version.version}`}
                    className="item"
                    style={{ gridTemplateColumns: "1fr auto", minHeight: "auto" }}
                  >
                    <div>
                      <p className="item-title">Version {version.version}</p>
                      <p className="item-meta">
                        {version.updatedAt ? new Date(version.updatedAt).toLocaleString() : "Default skill"}
                      </p>
                    </div>
                    <span className="project-row-side">
                      <Badge tone={version.isCurrent ? "green" : "neutral"}>
                        {version.isCurrent ? "current" : version.isDefault ? "default" : "archived"}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit skill">
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Description">
            <TextInput value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Prompt body">
            <TextArea value={body} onChange={(event) => setBody(event.target.value)} style={{ minHeight: 300 }} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !title.trim() || !body.trim()}>
              Save version
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
