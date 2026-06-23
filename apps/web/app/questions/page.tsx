import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveMemoryLibraryContent } from "../live-pages";

const sampleQuestions = [
  {
    title: "When should link enrichment run automatically?",
    summary: "Open question for balancing useful summaries against noise and cost.",
    source: "settings review",
    state: "open",
  },
];

export default function QuestionsPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Questions" title="Open loops worth preserving." />
      {isLiveConfigured() ? (
        <LiveMemoryLibraryContent objectTypes={["question"]} emptyMessage="No open questions have been accepted yet." />
      ) : (
        <div className="item-list">
          {sampleQuestions.map((question) => (
            <article className="item" key={question.title}>
              <span className="item-icon is-active">
                <icons.BookOpen size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{question.title}</p>
                <p className="item-meta">{question.summary}</p>
                <div className="toolbar" aria-label="Source references">
                  <span className="badge">{question.source}</span>
                </div>
              </div>
              <span className="badge gold">{question.state}</span>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
