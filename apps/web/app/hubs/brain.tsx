"use client";

import { useRouter } from "next/navigation";
import { LiveGate } from "../live-auth";
import { Tabs } from "../components";
import {
  LiveContactsContent,
  LiveGoalsContent,
  LiveMemoryContent,
} from "../live-pages";
import { LiveInterviewsIndex } from "../interviews/ui";
import { LiveLinksAndNotesContent } from "../links-notes";
import { eyebrowClass, mutedClass, pageHeaderClass } from "../page-classes";

// No Inbox tab: candidate memories merged into Review → Finds (owner decision
// Sep 4, ui-ux-improvement-plan.md) so there is one review surface. Brain is
// purely "what Skippy knows"; /brain/inbox redirects to the queue.
const TABS = [
  { key: "memory", label: "Memory" },
  { key: "library", label: "Library" },
  { key: "people", label: "People" },
  { key: "goals", label: "Goals" },
  { key: "check-ins", label: "Check-ins" },
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
            Accepted knowledge, saved resources, people, goals, and guided check-ins — all connected.
          </p>
        </div>
      </div>

      <div className="mb-[18px]">
        <Tabs items={TABS} active={tab} onChange={goToTab} />
      </div>

      {tab === "memory" ? <LiveMemoryContent /> : null}
      {tab === "library" ? <LiveLinksAndNotesContent /> : null}
      {tab === "people" ? <LiveContactsContent /> : null}
      {tab === "goals" ? <LiveGoalsContent /> : null}
      {tab === "check-ins" ? <LiveInterviewsIndex /> : null}
    </LiveGate>
  );
}
