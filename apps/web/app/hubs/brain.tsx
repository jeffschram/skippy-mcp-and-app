"use client";

import { useState } from "react";
import { LiveGate } from "../live-auth";
import { Tabs } from "../components";
import {
  LiveContactsContent,
  LiveGoalsContent,
  LiveMemoryInboxContent,
  LiveMemoryContent,
} from "../live-pages";
import { LiveContextMapContent } from "../context-map/context-map-content";
import { LiveInterviewsIndex } from "../interviews/ui";
import { LiveLinksAndNotesContent } from "../links-notes";

const TABS = [
  { key: "memory", label: "Memory" },
  { key: "inbox", label: "Inbox" },
  { key: "links", label: "Links" },
  { key: "contacts", label: "Contacts" },
  { key: "goals", label: "Goals" },
  { key: "interviews", label: "Interviews" },
  { key: "map", label: "Map" },
];

export function BrainContent() {
  const [tab, setTab] = useState("memory");

  return (
    <LiveGate>
      <div className="page-header">
        <div>
          <p className="eyebrow">Second brain</p>
          <h1>Everything Skippy knows.</h1>
          <p className="muted" style={{ maxWidth: 560 }}>
            Accepted knowledge, contacts, goals, guided check-ins, and the relationship map — all connected.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs items={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "memory" ? <LiveMemoryContent /> : null}
      {tab === "inbox" ? <LiveMemoryInboxContent /> : null}
      {tab === "links" ? <LiveLinksAndNotesContent /> : null}
      {tab === "contacts" ? <LiveContactsContent /> : null}
      {tab === "goals" ? <LiveGoalsContent /> : null}
      {tab === "interviews" ? <LiveInterviewsIndex /> : null}
      {tab === "map" ? <LiveContextMapContent /> : null}
    </LiveGate>
  );
}
