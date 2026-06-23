"use client";

import { useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { icons } from "../ui";

type AnyRecord = Record<string, any>;

const routineIcons: Record<string, keyof typeof icons> = {
  stale_assumption: "RefreshCw",
  open_question: "MessageSquareText",
  decision_revisit: "Shuffle",
  follow_up: "UserRound",
  context_gap: "BookOpen",
};

function formatGeneratedAt(value?: number) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function refLabel(ref: AnyRecord) {
  if (ref.refType === "memory") {
    return `memory: ${ref.label}`;
  }
  if (ref.refType === "source") {
    return `source: ${ref.label}`;
  }
  return `${ref.entityType}: ${ref.label}`;
}

function SuggestionItem({ suggestion }: { suggestion: AnyRecord }) {
  const Icon = icons[routineIcons[suggestion.type] ?? "BookOpen"];
  const contextSnippets = (suggestion.contextSnippets ?? []) as AnyRecord[];
  const relatedRefs = (suggestion.relatedRefs ?? []) as AnyRecord[];

  return (
    <article className="item">
      <span className={suggestion.type === "follow_up" ? "item-icon is-active" : "item-icon"}>
        <Icon size={17} aria-hidden />
      </span>
      <div>
        <p className="item-title">{suggestion.title}</p>
        <p className="item-meta">{suggestion.reason}</p>
        <p className="item-meta">
          <strong>Recommended:</strong> {suggestion.recommendedAction}
        </p>
        {contextSnippets.length ? (
          <div className="item-list" style={{ marginTop: 10 }}>
            {contextSnippets.slice(0, 3).map((context, index) => (
              <div key={`${suggestion.id}-context-${index}`} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>
                <p className="item-title">{context.label}</p>
                <p className="item-meta">{context.text}</p>
              </div>
            ))}
          </div>
        ) : null}
        {relatedRefs.length ? (
          <div className="toolbar" aria-label="Related references" style={{ marginTop: 10 }}>
            {relatedRefs.slice(0, 5).map((ref, index) => (
              <span className="badge" key={`${suggestion.id}-ref-${index}`}>
                {refLabel(ref)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {typeof suggestion.ageDays === "number" ? (
        <span className="badge gold">{suggestion.ageDays}d</span>
      ) : (
        <span className="badge blue">{suggestion.type.replace(/_/g, " ")}</span>
      )}
    </article>
  );
}

function SuggestionGroup({ group }: { group: AnyRecord }) {
  const suggestions = (group.suggestions ?? []) as AnyRecord[];

  return (
    <section className="card section">
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">{group.type?.replace(/_/g, " ")}</p>
          <h2>{group.label}</h2>
        </div>
        <span className="badge">{suggestions.length}</span>
      </div>
      {suggestions.length ? (
        <div className="item-list">
          {suggestions.map((suggestion) => (
            <SuggestionItem key={suggestion.id} suggestion={suggestion} />
          ))}
        </div>
      ) : (
        <p className="muted">No suggestions for this routine right now.</p>
      )}
    </section>
  );
}

export function LiveResurfacingContent() {
  const data = useQuery((api as AnyRecord).resurfacing.reviewSuggestionsForViewer, { limit: 35 }) as
    | AnyRecord
    | undefined;

  return (
    <LiveGate>
      {data === undefined ? (
        <section className="card section">
          <h2>Loading routines</h2>
          <p className="muted">Checking accepted memories, tasks, projects, people, questions, source refs, and settings.</p>
        </section>
      ) : data.empty ? (
        <section className="card section">
          <h2>No resurfacing suggestions</h2>
          <p className="muted">The bounded first-pass routines did not find stale assumptions, open loops, follow-ups, or context gaps.</p>
        </section>
      ) : (
        <>
          <section className="card section">
            <p className="eyebrow">Read-only routine pass</p>
            <h2>{data.suggestions?.length ?? 0} suggestions</h2>
            <p className="muted">
              Generated {formatGeneratedAt(data.generatedAt)} using recall cadence{" "}
              <span className="badge blue">{data.recallCadence}</span>. Nothing is created automatically.
            </p>
          </section>
          <div className="item-list">
            {(data.groups ?? []).map((group: AnyRecord) => (
              <SuggestionGroup key={group.type} group={group} />
            ))}
          </div>
        </>
      )}
    </LiveGate>
  );
}
