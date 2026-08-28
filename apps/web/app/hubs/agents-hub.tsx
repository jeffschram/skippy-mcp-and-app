"use client";

/**
 * The consolidated Agents hub (docs/connectors.md): everything about the
 * agent runtime in one place, ordered by the conceptual model — the agents
 * themselves, the skills that instruct them, the connectors they access, and
 * the hosts they run on. Public /skills/[slug] URLs stay where they are;
 * only the listing lives here.
 */

import { useState } from "react";
import { LiveGate } from "../live-auth";
import { Tabs } from "../components";
import { eyebrowClass, pageHeaderClass } from "../page-classes";
import { AgentsContent } from "./agents";
import { SkillsListBody } from "./skills";
import { ConnectorsContent } from "./connectors";
import { AgentHostsContent } from "./agent-hosts";
import { AgentUsageContent } from "./agent-usage";

const TABS = [
  { key: "agents", label: "Agents" },
  { key: "skills", label: "Skills" },
  { key: "connectors", label: "Connectors" },
  { key: "hosts", label: "Hosts" },
  { key: "usage", label: "Usage" },
];

const TAB_KEYS = new Set(TABS.map((tab) => tab.key));

export function AgentsHubContent({ initialTab }: { initialTab?: string | undefined }) {
  const [tab, setTab] = useState(initialTab && TAB_KEYS.has(initialTab) ? initialTab : "agents");

  return (
    <LiveGate>
      <div className={pageHeaderClass}>
        <div>
          <p className={eyebrowClass}>Agent runtime</p>
          <h1>Agents.</h1>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs items={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "agents" ? <AgentsContent /> : null}
      {tab === "skills" ? <SkillsListBody /> : null}
      {tab === "connectors" ? <ConnectorsContent /> : null}
      {tab === "hosts" ? <AgentHostsContent /> : null}
      {tab === "usage" ? <AgentUsageContent /> : null}
    </LiveGate>
  );
}
