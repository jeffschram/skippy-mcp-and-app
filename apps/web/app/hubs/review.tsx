"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { Tabs } from "../components";
import { LivePendingActionsContent, LiveTriageContent } from "../live-pages";
import { LiveResurfacingContent } from "../resurfacing/live-client";
import { useViewerReady } from "./use-viewer";
import { eyebrowClass, mutedClass, pageHeaderClass } from "../page-classes";

export function ReviewContent() {
  const [tab, setTab] = useState("signals");
  const viewerReady = useViewerReady();
  // Cheap counts query instead of dashboardForViewer — this page only needed
  // the two numbers, not the whole Home payload.
  const counts = useQuery(api.knowledge.reviewCountsForViewer, viewerReady ? {} : "skip") as
    | { finds: number; approvals: number }
    | undefined;

  // Target vocabulary from docs/ui-audit (one-queue plan): Finds = things Skippy
  // found and wants a yes/no on; Approvals = things Skippy wants to DO; Revisit =
  // older items worth a second look. Tabs merge into one list in a later phase.
  const tabs = [
    { key: "signals", label: "Finds", ...(counts ? { count: counts.finds } : {}) },
    { key: "actions", label: "Approvals", ...(counts ? { count: counts.approvals } : {}) },
    { key: "routines", label: "Revisit" },
  ];

  return (
    <LiveGate>
      <div className={pageHeaderClass}>
        <div>
          <p className={eyebrowClass}>Review queue</p>
          <h1>One place to decide.</h1>
          <p className={`${mutedClass} max-w-[560px]`}>
            Things Skippy found, things Skippy wants to do, and things worth a second look. Say yes or no and
            move on.
          </p>
        </div>
      </div>

      <div className="mb-[18px]">
        <Tabs items={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === "signals" ? <LiveTriageContent /> : null}
      {tab === "actions" ? <LivePendingActionsContent /> : null}
      {tab === "routines" ? <LiveResurfacingContent /> : null}
    </LiveGate>
  );
}
