import Link from "next/link";
import { AppShell, PageHeader, icons } from "../../ui";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { LiveMemoryDetailContent } from "../../live-pages";

const sampleMemories = [
  {
    id: "decision-reminder-sync",
    title: "Reminder completion sync stays approval-gated",
    type: "decision",
    summary: "Skippy can draft external reminder updates, but completion writes require explicit approval.",
    captureReason: "External side effects should be visible before execution.",
    state: "accepted",
    sources: ["pending action policy", "task completion review"],
    related: ["Pending actions", "Tasks"],
  },
  {
    id: "principle-short-tasks",
    title: "Short task titles",
    type: "principle",
    summary: "Task titles should be compact; detail belongs in descriptions or source refs.",
    captureReason: "User preference learned from review corrections.",
    state: "accepted",
    sources: ["triage correction"],
    related: ["Tasks", "Review"],
  },
  {
    id: "question-link-enrichment",
    title: "When should link enrichment run automatically?",
    type: "question",
    summary: "Open policy question for balancing useful summaries against noise and cost.",
    captureReason: "Needed before automatic link ingestion expands.",
    state: "open",
    sources: ["settings review"],
    related: ["Links", "Settings"],
  },
];

export default async function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const memoryId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Memory"
        title="Memory detail"
        action={
          <Link className="text-button" href="/library">
            Back to library
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveMemoryDetailContent memoryId={memoryId} /> : <StaticMemoryDetail memoryId={memoryId} />}
    </AppShell>
  );
}

function StaticMemoryDetail({ memoryId }: { memoryId: string }) {
  const memory = sampleMemories.find((candidate) => candidate.id === memoryId);

  if (!memory) {
    return (
      <section className="card section">
        <h2>Memory not found</h2>
        <p className="muted">
          This memory may have been removed. <Link href="/library">Back to library</Link>.
        </p>
      </section>
    );
  }

  return (
    <div className="grid">
      <section className="card section span-12">
        <div className="settings-row">
          <div>
            <h2>{memory.title}</h2>
            <p className="muted">{memory.summary}</p>
          </div>
          <span className={memory.state === "open" ? "badge gold" : "badge blue"}>{memory.state}</span>
        </div>
        <div className="toolbar">
          <span className="badge blue">{memory.type}</span>
        </div>
        <p className="muted">Capture: {memory.captureReason}</p>
      </section>
      <section className="card section span-6">
        <h2>Sources</h2>
        <div className="item-list">
          {memory.sources.map((source) => (
            <article className="item" key={source}>
              <span className="item-icon">
                <icons.LinkIcon size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{source}</p>
                <p className="item-meta">Static preview source reference.</p>
              </div>
              <span className="badge">source</span>
            </article>
          ))}
        </div>
      </section>
      <section className="card section span-6">
        <h2>Related entities</h2>
        <div className="item-list">
          {memory.related.map((entity) => (
            <article className="item" key={entity}>
              <span className="item-icon">
                <icons.LinkIcon size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{entity}</p>
                <p className="item-meta">Related memory context.</p>
              </div>
              <span className="badge blue">related</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
