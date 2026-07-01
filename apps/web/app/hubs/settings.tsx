"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ArchiveRestore, FolderKanban } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { Badge, Button, Card, EmptyState, LoadingRow, Tabs, useToast } from "../components";
import { LiveIngestionLogsContent, LiveSettingsContent } from "../live-pages";
import { projectStatusTone } from "../../lib/display";
import { useViewerReady } from "./use-viewer";

const TABS = [
  { key: "settings", label: "Settings" },
  { key: "archived-projects", label: "Archived projects" },
  { key: "logs", label: "Activity logs" },
  { key: "about", label: "About" },
];

type AnyRecord = Record<string, any>;

function ArchivedProjects() {
  const viewerReady = useViewerReady();
  const archivedProjects = useQuery(api.projects.archivedProjectsForViewer, viewerReady ? {} : "skip") as
    | AnyRecord[]
    | undefined;
  const updateProject = useMutation(api.projects.updateProjectForViewer);
  const toast = useToast();

  const restoreProject = async (projectId: string) => {
    try {
      await updateProject({ projectId: projectId as any, status: "planned" } as any);
      toast("Project restored.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not restore project", "error");
    }
  };

  if (archivedProjects === undefined) {
    return (
      <Card>
        <LoadingRow label="Loading archived projects..." />
      </Card>
    );
  }

  if (!archivedProjects.length) {
    return (
      <Card>
        <EmptyState icon={<ArchiveRestore size={20} aria-hidden />} title="No archived projects">
          Archived projects will appear here when you need to restore one.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "grid", gap: 10 }}>
        {archivedProjects.map((project: AnyRecord) => (
          <div key={project._id} className="item project-row" style={{ gridTemplateColumns: "auto 1fr auto" }}>
            <span className="item-icon">
              <FolderKanban size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">
                <Link href={`/projects/${project._id}`}>{project.title}</Link>
              </p>
              <p className="item-meta">{project.summary || "Archived project"}</p>
            </div>
            <span className="project-row-side">
              <Badge tone={projectStatusTone(project.status)}>archived</Badge>
              <Button small onClick={() => void restoreProject(project._id)}>
                Restore
              </Button>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function About() {
  return (
    <Card>
      <h2>What Skippy is</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Skippy is both an MCP server and this web app — a supervised second brain and project dashboard. Connected harnesses
        (like Claude) capture knowledge through MCP tools; you review and direct it here.
      </p>
      <h3 style={{ marginTop: 20 }}>The plan → execute loop</h3>
      <ul style={{ paddingLeft: 18, lineHeight: 1.6, maxWidth: 640 }}>
        <li>Create a project, then <strong>Plan with AI</strong> to decompose it into ordered task briefs.</li>
        <li>Each task carries an execution brief and acceptance criteria you can copy into a coding agent.</li>
        <li>The agent reports progress back through MCP; you supervise the board and approve results.</li>
      </ul>
      <h3 style={{ marginTop: 20 }}>Connect a harness</h3>
      <p className="muted" style={{ maxWidth: 640 }}>
        Create an MCP token in the Settings tab, then point your harness at <span className="code">/api/mcp</span> with that
        token. Skippy exposes capture, recall, interview, planning, and task-execution tools.
      </p>
    </Card>
  );
}

export function SettingsContent() {
  const [tab, setTab] = useState("settings");

  return (
    <LiveGate>
      <div className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Settings.</h1>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs items={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "settings" ? <LiveSettingsContent /> : null}
      {tab === "archived-projects" ? <ArchivedProjects /> : null}
      {tab === "logs" ? <LiveIngestionLogsContent /> : null}
      {tab === "about" ? <About /> : null}
    </LiveGate>
  );
}
