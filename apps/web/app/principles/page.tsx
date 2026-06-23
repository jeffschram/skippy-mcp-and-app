import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveMemoryLibraryContent } from "../live-pages";

const samplePrinciples = [
  {
    title: "Short task titles",
    summary: "Keep tasks compact and put supporting detail in descriptions or source references.",
    source: "triage correction",
    state: "accepted",
  },
];

export default function PrinciplesPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Principles" title="Preferences and operating rules learned over time." />
      {isLiveConfigured() ? (
        <LiveMemoryLibraryContent objectTypes={["principle"]} emptyMessage="No principles have been accepted yet." />
      ) : (
        <div className="item-list">
          {samplePrinciples.map((principle) => (
            <article className="item" key={principle.title}>
              <span className="item-icon">
                <icons.BookOpen size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{principle.title}</p>
                <p className="item-meta">{principle.summary}</p>
                <div className="toolbar" aria-label="Source references">
                  <span className="badge">{principle.source}</span>
                </div>
              </div>
              <span className="badge blue">{principle.state}</span>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
