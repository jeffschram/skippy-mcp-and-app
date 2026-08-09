"use client";

import { useRouter } from "next/navigation";
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
import { eyebrowClass, mutedClass, pageHeaderClass } from "../page-classes";

const TABS = [
  { key: "memory", label: "Memory" },
  { key: "inbox", label: "Inbox" },
  { key: "links", label: "Links" },
  { key: "contacts", label: "Contacts" },
  { key: "goals", label: "Goals" },
  { key: "interviews", label: "Interviews" },
  { key: "map", label: "Map" },
];

const TAB_KEYS = new Set(TABS.map((tab) => tab.key));
const DEFAULT_TAB = "memory";

// The Brain hub's sub-views each own a URL (/brain/links, /brain/contacts, …)
// so processed captures and other surfaces can deep-link — and anchor into a
// specific row. Unknown or missing segments fall back to Memory.
export function resolveBrainTab(section: string | undefined): string {
  return section && TAB_KEYS.has(section) ? section : DEFAULT_TAB;
}

export function BrainContent({ section }: { section?: string | undefined }) {
  const router = useRouter();
  const tab = resolveBrainTab(section);

  const goToTab = (key: string) => {
    // Keep the canonical Brain root on Memory; every other view gets its path.
    router.push(key === DEFAULT_TAB ? "/brain" : `/brain/${key}`);
  };

  return (
    <LiveGate>
      <div className={pageHeaderClass}>
        <div>
          <p className={eyebrowClass}>Second brain</p>
          <h1>Everything Skippy knows.</h1>
          <p className={`${mutedClass} max-w-[560px]`}>
            Accepted knowledge, contacts, goals, guided check-ins, and the relationship map — all connected.
          </p>
        </div>
      </div>

      <div className="mb-[18px]">
        <Tabs items={TABS} active={tab} onChange={goToTab} />
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
