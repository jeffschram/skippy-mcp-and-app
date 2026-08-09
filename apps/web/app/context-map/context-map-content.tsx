"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { cn } from "@/lib/utils";
import { LiveGate } from "../live-auth";
import {
  badgeBlueClass,
  badgeClass,
  cardClass,
  checkboxFieldBottomClass,
  fieldClass,
  fieldLabelClass,
  gridClass,
  inputClass,
  itemClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
  projectRowClass,
  projectRowSideClass,
  sectionClass,
  settingsRowClass,
  span6Class,
  span12Class,
  splitListClass,
  textButtonClass,
  textButtonCompactClass,
  toolbarClass,
} from "../page-classes";
import { icons } from "../ui";

type AnyRecord = Record<string, any>;

function useViewerReady() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: AnyRecord | null }
    | null
    | undefined;

  return Boolean(viewer?.brain);
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function formatDate(value?: number) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(value);
}

function memoryTitle(memory: AnyRecord) {
  return textValue(memory.title, memory.summary, memory.body, memory.objectType) || "Untitled memory";
}

function memorySummary(memory: AnyRecord) {
  return textValue(memory.summary, memory.body, memory.captureReason) || "No summary yet.";
}

function memoryHref(memory: AnyRecord) {
  return memory._id ? `/memory/${encodeURIComponent(String(memory._id))}` : "/memory";
}

function sourceTitle(sourceRef: AnyRecord) {
  return textValue(
    sourceRef.summary,
    sourceRef.excerpt,
    sourceRef.externalId,
    sourceRef.messageId,
    sourceRef.eventId,
    sourceRef.threadId,
    sourceRef.sourceSystem,
  ) || "Source reference";
}

function sourceMeta(sourceRef: AnyRecord) {
  const sourceSystem = textValue(sourceRef.sourceSystem) || "source";
  const date = formatDate(sourceRef.sourceTimestamp);
  const participants = Array.isArray(sourceRef.participants) ? sourceRef.participants : [];
  return [sourceSystem, date, ...participants].filter(Boolean).join(" - ");
}

function entityHref(entityType: string, entityId: string) {
  if (entityType === "project") {
    return `/projects/${encodeURIComponent(entityId)}`;
  }
  if (entityType === "person" || entityType === "company") {
    return "/contacts";
  }
  if (entityType === "task") {
    return "/tasks";
  }
  return undefined;
}

function MemoryList({ memories, empty }: { memories: AnyRecord[]; empty: string }) {
  if (memories.length === 0) {
    return <p className={mutedClass}>{empty}</p>;
  }

  return (
    <div className={itemListClass}>
      {memories.map((memory) => (
        <Link className={cn(itemClass, projectRowClass)} href={memoryHref(memory)} key={String(memory._id ?? memoryTitle(memory))}>
          <span className={itemIconClass}>
            <icons.BookOpen size={17} aria-hidden />
          </span>
          <div>
            <p className={itemTitleClass}>{memoryTitle(memory)}</p>
            <p className={itemMetaClass}>
              {textValue(memory.memoryType, memory.status) || "memory"}
              {memory.updatedAt || memory.createdAt ? ` - ${formatDate(memory.updatedAt ?? memory.createdAt)}` : ""}
            </p>
            <p className={itemMetaClass}>{memorySummary(memory)}</p>
          </div>
          <span className={projectRowSideClass}>
            <span className={cn(badgeClass, badgeBlueClass)}>{textValue(memory.memoryType) || "memory"}</span>
            <icons.ChevronRight size={18} aria-hidden />
          </span>
        </Link>
      ))}
    </div>
  );
}

function SourceList({ sourceRefs, empty }: { sourceRefs: AnyRecord[]; empty: string }) {
  if (sourceRefs.length === 0) {
    return <p className={mutedClass}>{empty}</p>;
  }

  return (
    <div className={itemListClass}>
      {sourceRefs.map((sourceRef) => {
        const content = (
          <>
            <span className={itemIconClass}>
              <icons.LinkIcon size={17} aria-hidden />
            </span>
            <div>
              <p className={itemTitleClass}>{sourceTitle(sourceRef)}</p>
              <p className={itemMetaClass}>{sourceMeta(sourceRef)}</p>
            </div>
            <span className={badgeClass}>{textValue(sourceRef.sourceSystem) || "source"}</span>
          </>
        );
        const href = textValue(sourceRef.deepLink, sourceRef.url);
        return href ? (
          <a className={cn(itemClass, projectRowClass)} href={href} key={String(sourceRef._id ?? href)} rel="noreferrer" target="_blank">
            {content}
          </a>
        ) : (
          <article className={itemClass} key={String(sourceRef._id ?? sourceTitle(sourceRef))}>
            {content}
          </article>
        );
      })}
    </div>
  );
}

function EntityMiniList({ entities }: { entities: AnyRecord[] }) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <div className={toolbarClass} aria-label="Related entities">
      {entities.slice(0, 8).map((entity) => {
        const href = entityHref(entity.ref?.entityType, entity.ref?.entityId);
        const label = textValue(entity.title, entity.entity?.title, entity.entity?.name, entity.ref?.entityId) || "Related";
        return href ? (
          <Link className={cn(badgeClass, badgeBlueClass)} href={href} key={`${entity.ref?.entityType}:${entity.ref?.entityId}`}>
            {label}
          </Link>
        ) : (
          <span className={cn(badgeClass, badgeBlueClass)} key={`${entity.ref?.entityType}:${entity.ref?.entityId}:${label}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function ProjectContextCard({ map }: { map: AnyRecord }) {
  const project = map.project ?? {};
  return (
    <section className={cn(cardClass, sectionClass, span12Class)}>
      <div className={settingsRowClass}>
        <div>
          <h2>{textValue(project.title) || "Untitled project"}</h2>
          <p className={mutedClass}>{textValue(project.summary, project.priorityReason) || "Accepted project context."}</p>
        </div>
        <Link className={cn(textButtonClass, textButtonCompactClass)} href={`/projects/${encodeURIComponent(String(project._id))}`}>
          Open
        </Link>
      </div>
      <div className={gridClass}>
        <section className={span6Class}>
          <h3>Tasks</h3>
          {map.tasks?.length ? (
            <div className={itemListClass}>
              {map.tasks.map((task: AnyRecord) => (
                <Link className={cn(itemClass, projectRowClass)} href="/tasks" key={String(task._id)}>
                  <span className={itemIconClass}>
                    <icons.Check size={17} aria-hidden />
                  </span>
                  <div>
                    <p className={itemTitleClass}>{textValue(task.title) || "Untitled task"}</p>
                    <p className={itemMetaClass}>{textValue(task.description, task.priorityReason, task.status) || "Accepted task"}</p>
                  </div>
                  <span className={cn(badgeClass, badgeBlueClass)}>{textValue(task.status) || "task"}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className={mutedClass}>No linked accepted tasks in this bounded map.</p>
          )}
        </section>
        <section className={span6Class}>
          <h3>Memories</h3>
          <MemoryList memories={map.memories ?? []} empty="No accepted memories linked to this project yet." />
        </section>
        <section className={span12Class}>
          <h3>Sources</h3>
          <SourceList sourceRefs={map.sourceRefs ?? []} empty="No source refs surfaced through linked memories yet." />
        </section>
      </div>
    </section>
  );
}

function ContactContextCard({ map }: { map: AnyRecord }) {
  return (
    <section className={cn(cardClass, sectionClass, span6Class)}>
      <div className={settingsRowClass}>
        <div>
          <h2>{textValue(map.title, map.entity?.name) || "Untitled contact"}</h2>
          <p className={mutedClass}>{textValue(map.summary, map.entity?.relationshipContext, map.entity?.notes) || "Accepted contact context."}</p>
        </div>
        <Link className={cn(textButtonClass, textButtonCompactClass)} href="/contacts">
          Open
        </Link>
      </div>
      <EntityMiniList entities={map.relatedEntities ?? []} />
      <h3>Memories</h3>
      <MemoryList memories={map.memories ?? []} empty="No accepted memories linked to this contact yet." />
      <h3>Sources</h3>
      <SourceList sourceRefs={map.sourceRefs ?? []} empty="No source refs surfaced through linked memories yet." />
    </section>
  );
}

function QuestionContextCard({ map }: { map: AnyRecord }) {
  const question = map.question ?? {};
  return (
    <section className={cn(cardClass, sectionClass, span6Class)}>
      <div className={settingsRowClass}>
        <div>
          <h2>{memoryTitle(question)}</h2>
          <p className={mutedClass}>{memorySummary(question)}</p>
        </div>
        <Link className={cn(textButtonClass, textButtonCompactClass)} href={memoryHref(question)}>
          Open
        </Link>
      </div>
      <h3>Related memories</h3>
      <MemoryList memories={map.relatedMemories ?? []} empty="No nearby memories share this question's entity refs yet." />
      <h3>Sources</h3>
      <SourceList sourceRefs={map.sourceRefs ?? []} empty="No source refs attached to this question yet." />
    </section>
  );
}

export function LiveContextMapContent() {
  const viewerReady = useViewerReady();
  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const queryArgs = useMemo(
    () => (viewerReady ? { query: submittedQuery.trim() || undefined } : "skip"),
    [submittedQuery, viewerReady],
  );
  const data = useQuery(api.memoryGraph.contextualMapForViewer, queryArgs as any) as AnyRecord | undefined;
  const hasAnyMap =
    (data?.projects?.length ?? 0) > 0 ||
    (data?.contacts?.length ?? 0) > 0 ||
    (data?.questions?.length ?? 0) > 0 ||
    (data?.queryMatches?.length ?? 0) > 0;

  return (
    <LiveGate>
      <div className={gridClass}>
        <section className={cn(cardClass, sectionClass, span12Class)}>
          <form
            className={splitListClass}
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(draftQuery);
            }}
          >
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Question or phrase</span>
              <input
                className={inputClass}
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Search accepted memory context"
              />
            </label>
            <div className={cn(toolbarClass, checkboxFieldBottomClass)}>
              <button className={textButtonClass} type="submit">
                Search
              </button>
              {submittedQuery ? (
                <button
                  className={textButtonClass}
                  type="button"
                  onClick={() => {
                    setDraftQuery("");
                    setSubmittedQuery("");
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>
        </section>

        {!data ? (
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Loading context map</h2>
            <p className={mutedClass}>Collecting bounded project, contact, memory, and source context from Convex.</p>
          </section>
        ) : !hasAnyMap ? (
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>No context links yet</h2>
            <p className={mutedClass}>Accepted projects, contacts, questions, memories, and source refs will appear here after ingestion links them.</p>
          </section>
        ) : (
          <>
            {submittedQuery ? (
              <section className={cn(cardClass, sectionClass, span12Class)}>
                <div className={settingsRowClass}>
                  <div>
                    <h2>Question matches</h2>
                    <p className={mutedClass}>Accepted memories and source refs matching "{submittedQuery.trim()}".</p>
                  </div>
                  <span className={cn(badgeClass, badgeBlueClass)}>{data.queryMatches?.length ?? 0} memories</span>
                </div>
                <MemoryList memories={data.queryMatches ?? []} empty="No accepted memories matched that question." />
                <h3>Sources</h3>
                <SourceList sourceRefs={data.querySourceRefs ?? []} empty="No source refs matched through those memories." />
              </section>
            ) : null}

            <section className={span12Class}>
              <div className={settingsRowClass}>
                <div>
                  <h2>Projects</h2>
                  <p className={mutedClass}>Accepted projects with linked tasks, memories, and source refs.</p>
                </div>
                <span className={badgeClass}>{data.projects?.length ?? 0}</span>
              </div>
            </section>
            {(data.projects ?? []).map((map: AnyRecord) => (
              <ProjectContextCard key={String(map.project?._id ?? map.project?.title)} map={map} />
            ))}

            <section className={span12Class}>
              <div className={settingsRowClass}>
                <div>
                  <h2>People and companies</h2>
                  <p className={mutedClass}>Accepted contacts with nearby memories and evidence.</p>
                </div>
                <span className={badgeClass}>{data.contacts?.length ?? 0}</span>
              </div>
            </section>
            {(data.contacts ?? []).map((map: AnyRecord) => (
              <ContactContextCard key={`${map.ref?.entityType}:${map.ref?.entityId}`} map={map} />
            ))}

            <section className={span12Class}>
              <div className={settingsRowClass}>
                <div>
                  <h2>Questions</h2>
                  <p className={mutedClass}>Accepted questions with shared memory context and source refs.</p>
                </div>
                <span className={badgeClass}>{data.questions?.length ?? 0}</span>
              </div>
            </section>
            {(data.questions ?? []).map((map: AnyRecord) => (
              <QuestionContextCard key={String(map.question?._id ?? map.question?.title)} map={map} />
            ))}
          </>
        )}
      </div>
    </LiveGate>
  );
}
