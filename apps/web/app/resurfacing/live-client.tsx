"use client";

import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import {
  badgeBlueClass,
  badgeClass,
  badgeGoldClass,
  cardClass,
  eyebrowClass,
  itemClass,
  itemIconActiveClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
  pageHeaderClass,
  sectionClass,
  toolbarClass,
} from "../page-classes";
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
    <article className={itemClass}>
      <span className={cn(itemIconClass, suggestion.type === "follow_up" && itemIconActiveClass)}>
        <Icon size={17} aria-hidden />
      </span>
      <div>
        <p className={itemTitleClass}>{suggestion.title}</p>
        <p className={itemMetaClass}>{suggestion.reason}</p>
        <p className={itemMetaClass}>
          <strong>Recommended:</strong> {suggestion.recommendedAction}
        </p>
        {contextSnippets.length ? (
          <div className={itemListClass} style={{ marginTop: 10 }}>
            {contextSnippets.slice(0, 3).map((context, index) => (
              <div key={`${suggestion.id}-context-${index}`} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>
                <p className={itemTitleClass}>{context.label}</p>
                <p className={itemMetaClass}>{context.text}</p>
              </div>
            ))}
          </div>
        ) : null}
        {relatedRefs.length ? (
          <div className={toolbarClass} aria-label="Related references" style={{ marginTop: 10 }}>
            {relatedRefs.slice(0, 5).map((ref, index) => (
              <span className={badgeClass} key={`${suggestion.id}-ref-${index}`}>
                {refLabel(ref)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {typeof suggestion.ageDays === "number" ? (
        <span className={cn(badgeClass, badgeGoldClass)}>{suggestion.ageDays}d</span>
      ) : (
        <span className={cn(badgeClass, badgeBlueClass)}>{suggestion.type.replace(/_/g, " ")}</span>
      )}
    </article>
  );
}

// Exported for the unified Review queue (Revisit section) — the one-queue
// decision folded this page's groups into /review as the bottom section.
export function SuggestionGroup({ group }: { group: AnyRecord }) {
  const suggestions = (group.suggestions ?? []) as AnyRecord[];

  return (
    <section className={cn(cardClass, sectionClass)}>
      <div className={pageHeaderClass} style={{ marginBottom: 14 }}>
        <div>
          <p className={eyebrowClass}>{group.type?.replace(/_/g, " ")}</p>
          <h2>{group.label}</h2>
        </div>
        <span className={badgeClass}>{suggestions.length}</span>
      </div>
      {suggestions.length ? (
        <div className={itemListClass}>
          {suggestions.map((suggestion) => (
            <SuggestionItem key={suggestion.id} suggestion={suggestion} />
          ))}
        </div>
      ) : (
        <p className={mutedClass}>No suggestions for this routine right now.</p>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Checking for things to revisit</h2>
          <p className={mutedClass}>Looking through your memories, tasks, projects, and contacts.</p>
        </section>
      ) : data.empty ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Nothing to revisit</h2>
          <p className={mutedClass}>Nothing here looks stale or forgotten right now.</p>
        </section>
      ) : (
        <>
          <section className={cn(cardClass, sectionClass)}>
            <p className={eyebrowClass}>Worth a second look</p>
            <h2>{data.suggestions?.length ?? 0} suggestions</h2>
            <p className={mutedClass}>
              Checked {formatGeneratedAt(data.generatedAt)}. These are suggestions only — nothing changes unless
              you act on it.
            </p>
          </section>
          <div className={itemListClass}>
            {/* Hide routines that found nothing (docs/ui-audit fix: empty sections
                added noise without helping the owner decide anything). */}
            {(data.groups ?? [])
              .filter((group: AnyRecord) => ((group.suggestions ?? []) as AnyRecord[]).length > 0)
              .map((group: AnyRecord) => (
                <SuggestionGroup key={group.type} group={group} />
              ))}
          </div>
        </>
      )}
    </LiveGate>
  );
}
