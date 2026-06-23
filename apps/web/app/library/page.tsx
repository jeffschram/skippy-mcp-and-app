import Link from "next/link";
import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveMemoryLibraryContent } from "../live-pages";

const sampleMemories = [
  {
    id: "decision-reminder-sync",
    title: "Reminder completion sync stays approval-gated",
    type: "decision",
    summary: "Skippy can draft external reminder updates, but completion writes require explicit approval.",
    captureReason: "External side effects should be visible before execution.",
    state: "accepted",
    source: "pending action policy",
  },
  {
    id: "principle-short-tasks",
    title: "Short task titles",
    type: "principle",
    summary: "Task titles should be compact; detail belongs in descriptions or source refs.",
    captureReason: "User preference learned from review corrections.",
    state: "accepted",
    source: "triage correction",
  },
  {
    id: "question-link-enrichment",
    title: "When should link enrichment run automatically?",
    type: "question",
    summary: "Open policy question for balancing useful summaries against noise and cost.",
    captureReason: "Needed before automatic link ingestion expands.",
    state: "open",
    source: "settings review",
  },
];

export default function LibraryPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Library"
        title="Accepted second-brain memory."
        action={
          <div className="toolbar">
            <Link className="text-button compact" href="/decisions">
              Decisions
            </Link>
            <Link className="text-button compact" href="/principles">
              Principles
            </Link>
            <Link className="text-button compact" href="/questions">
              Questions
            </Link>
          </div>
        }
      />
      {isLiveConfigured() ? (
        <LiveMemoryLibraryContent />
      ) : (
        <div className="item-list">
          {sampleMemories.map((memory) => (
            <Link className="item project-row" href={`/library/${encodeURIComponent(memory.id)}`} key={memory.id}>
              <span className="item-icon">
                <icons.BookOpen size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{memory.title}</p>
                <p className="item-meta">
                  {memory.type} · {memory.summary}
                </p>
                <p className="item-meta">Capture: {memory.captureReason}</p>
                <div className="toolbar" aria-label="Source references">
                  <span className="badge">{memory.source}</span>
                </div>
              </div>
              <span className="project-row-side">
                <span className={memory.state === "open" ? "badge gold" : "badge blue"}>{memory.state}</span>
                <icons.ChevronRight size={18} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
