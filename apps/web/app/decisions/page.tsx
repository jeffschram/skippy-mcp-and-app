import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveMemoryLibraryContent } from "../live-pages";

const sampleDecisions = [
  {
    title: "Reminder completion sync stays approval-gated",
    summary: "External reminder writes require explicit review until provider sync is proven reliable.",
    source: "pending action policy",
    state: "accepted",
  },
];

export default function DecisionsPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Decisions" title="Durable choices Skippy should remember." />
      {isLiveConfigured() ? (
        <LiveMemoryLibraryContent objectTypes={["decision"]} emptyMessage="No decisions have been accepted yet." />
      ) : (
        <div className="item-list">
          {sampleDecisions.map((decision) => (
            <article className="item" key={decision.title}>
              <span className="item-icon">
                <icons.BookOpen size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{decision.title}</p>
                <p className="item-meta">{decision.summary}</p>
                <div className="toolbar" aria-label="Source references">
                  <span className="badge">{decision.source}</span>
                </div>
              </div>
              <span className="badge blue">{decision.state}</span>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
