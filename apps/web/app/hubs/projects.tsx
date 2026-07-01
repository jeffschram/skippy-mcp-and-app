"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { Badge, Button, Card, Dialog, EmptyState, Field, LoadingRow, TextArea, TextInput, useToast } from "../components";
import { projectStatusTone } from "../../lib/display";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

export function ProjectsListContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.projectsAndTasksForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const createProject = useMutation(api.knowledge.createProjectForViewer);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of data?.tasks ?? []) {
      if (task.projectId) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [data?.tasks]);

  const projects = (data?.projects ?? []).filter((project: AnyRecord) => project.status !== "archived").slice().sort((a: AnyRecord, b: AnyRecord) => {
    const order = ["in_progress", "planned", "idea", "paused", "completed", "cancelled", "archived"];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createProject({ title: title.trim(), ...(summary.trim() ? { summary: summary.trim() } : {}) });
      toast("Project created.", "success");
      setOpen(false);
      setTitle("");
      setSummary("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create project", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LiveGate>
      <div className="page-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Build, supervised.</h1>
          <p className="muted" style={{ maxWidth: 560 }}>
            Each project can be decomposed by Skippy into executable task briefs you hand to a coding agent.
          </p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus size={17} aria-hidden /> New project
        </Button>
      </div>

      {data === undefined ? (
        <Card>
          <LoadingRow label="Loading projects…" />
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban size={22} aria-hidden />}
            title="No projects yet"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus size={16} aria-hidden /> New project
              </Button>
            }
          >
            Create a project, then let Skippy plan it into tasks.
          </EmptyState>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {projects.map((project: AnyRecord) => {
            const count = taskCountByProject.get(project._id) ?? 0;
            return (
              <Link key={project._id} className="item project-row" href={`/projects/${project._id}`} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <span className="item-icon">
                  <FolderKanban size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{project.title}</p>
                  <p className="item-meta">
                    {project.summary ? `${project.summary} · ` : ""}
                    {count} open task{count === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="project-row-side">
                  <Badge tone={projectStatusTone(project.status)}>{String(project.status).replace(/_/g, " ")}</Badge>
                  <ArrowRight size={18} aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New project">
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Ship the billing page" autoFocus />
          </Field>
          <Field label="Summary (optional)">
            <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is this project about?" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void submit()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </LiveGate>
  );
}
