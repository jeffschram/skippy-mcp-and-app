import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell, PageHeader, icons } from "../ui";
import { LiveResurfacingContent } from "./live-client";

const sampleGroups = [
  {
    label: "Stale assumptions",
    type: "stale_assumption",
    suggestions: [
      {
        title: "Re-check: Link enrichment should stay manual",
        reason: "This assumption is old enough to verify against current usage.",
        recommendedAction: "Confirm whether the default still fits, then update or archive the memory.",
        badge: "62d",
      },
    ],
  },
  {
    label: "Open questions",
    type: "open_question",
    suggestions: [
      {
        title: "When should project context be promoted into a summary?",
        reason: "Accepted questions stay visible until they are answered or archived.",
        recommendedAction: "Answer it, link it to the affected project, or close it out.",
        badge: "open",
      },
    ],
  },
  {
    label: "People to follow up with",
    type: "follow_up",
    suggestions: [
      {
        title: "Follow up with a saved contact",
        reason: "Waiting tasks and follow-up relationships can surface here.",
        recommendedAction: "Check in or convert the loop into an explicit task.",
        badge: "read-only",
      },
    ],
  },
];

function iconFor(type: string) {
  if (type === "stale_assumption") {
    return icons.RefreshCw;
  }
  if (type === "open_question") {
    return icons.MessageSquareText;
  }
  if (type === "follow_up") {
    return icons.UserRound;
  }
  return icons.BookOpen;
}

function StaticResurfacingContent() {
  return (
    <div className="item-list">
      <section className="card section">
        <p className="eyebrow">Static preview</p>
        <h2>Read-only resurfacing routines</h2>
        <p className="muted">
          Connect Convex and sign in to compute suggestions from accepted memories, tasks, projects, people, source refs, and settings.
        </p>
      </section>
      {sampleGroups.map((group) => {
        const Icon = iconFor(group.type);
        return (
          <section className="card section" key={group.type}>
            <div className="page-header" style={{ marginBottom: 14 }}>
              <div>
                <p className="eyebrow">{group.type.replace(/_/g, " ")}</p>
                <h2>{group.label}</h2>
              </div>
              <span className="badge">{group.suggestions.length}</span>
            </div>
            <div className="item-list">
              {group.suggestions.map((suggestion) => (
                <article className="item" key={suggestion.title}>
                  <span className={group.type === "follow_up" ? "item-icon is-active" : "item-icon"}>
                    <Icon size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">{suggestion.title}</p>
                    <p className="item-meta">{suggestion.reason}</p>
                    <p className="item-meta">
                      <strong>Recommended:</strong> {suggestion.recommendedAction}
                    </p>
                  </div>
                  <span className="badge gold">{suggestion.badge}</span>
                </article>
              ))}
            </div>
          </section>
        );
      })}
      <section className="card section">
        <h2>Nothing to review</h2>
        <p className="muted">When a live routine has no matches, this page shows an empty state instead of creating work for you.</p>
      </section>
    </div>
  );
}

export default function ResurfacingPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Resurfacing" title="Review routines without automatic actions." />
      {isLiveConfigured() ? <LiveResurfacingContent /> : <StaticResurfacingContent />}
    </AppShell>
  );
}
