"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { Tabs } from "../components";
import { LivePendingActionsContent, LiveTriageContent } from "../live-pages";
import { LiveResurfacingContent } from "../resurfacing/live-client";
import { useViewerReady } from "./use-viewer";

export function ReviewContent() {
  const [tab, setTab] = useState("signals");
  const viewerReady = useViewerReady();
  const dashboard = useQuery(api.knowledge.dashboardForViewer, viewerReady ? {} : "skip") as
    | Record<string, any>
    | undefined;

  const tabs = [
    { key: "signals", label: "Signals", count: dashboard?.triageItems?.length },
    { key: "actions", label: "Actions", count: dashboard?.pendingActions?.length },
    { key: "routines", label: "Routines" },
  ];

  return (
    <LiveGate>
      <div className="page-header">
        <div>
          <p className="eyebrow">Review queue</p>
          <h1>One place to decide.</h1>
          <p className="muted" style={{ maxWidth: 560 }}>
            Unclear signals, external actions awaiting approval, and recall routines — triage them together.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs items={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === "signals" ? <LiveTriageContent /> : null}
      {tab === "actions" ? <LivePendingActionsContent /> : null}
      {tab === "routines" ? <LiveResurfacingContent /> : null}
    </LiveGate>
  );
}
