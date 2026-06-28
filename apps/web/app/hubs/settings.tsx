"use client";

import { useState } from "react";
import { LiveGate } from "../live-auth";
import { Card, Tabs } from "../components";
import { LiveIngestionLogsContent, LiveSettingsContent } from "../live-pages";

const TABS = [
  { key: "settings", label: "Settings" },
  { key: "logs", label: "Activity logs" },
  { key: "about", label: "About" },
];

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
      {tab === "logs" ? <LiveIngestionLogsContent /> : null}
      {tab === "about" ? <About /> : null}
    </LiveGate>
  );
}
