import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveMemoryInboxContent } from "../live-pages";

const sampleInboxItems = [
  {
    title: "Prefer short task titles",
    type: "principle",
    summary: "Keep created tasks concise enough to scan quickly.",
    captureReason: "Repeated correction during task review.",
    state: "needs_review",
    source: "triage correction",
  },
  {
    title: "Decide reminder completion sync policy",
    type: "decision",
    summary: "External reminder completion should remain approval-gated until provider writes are verified.",
    captureReason: "Affects external side effects and user trust.",
    state: "suggested",
    source: "pending action review",
  },
];

export default function MemoryInboxPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Memory inbox" title="Captured memories needing review." />
      {isLiveConfigured() ? (
        <LiveMemoryInboxContent />
      ) : sampleInboxItems.length === 0 ? (
        <section className="card section">
          <h2>Inbox clear</h2>
          <p className="muted">No captured memory objects need review right now.</p>
        </section>
      ) : (
        <div className="item-list">
          {sampleInboxItems.map((item) => (
            <article className="item" key={item.title}>
              <span className="item-icon is-active">
                <icons.Brain size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{item.title}</p>
                <p className="item-meta">
                  {item.type} · {item.summary}
                </p>
                <p className="item-meta">Capture: {item.captureReason}</p>
                <div className="toolbar" aria-label="Source references">
                  <span className="badge">{item.source}</span>
                </div>
              </div>
              <span className="badge gold">{item.state}</span>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
