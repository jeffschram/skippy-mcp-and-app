"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
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
    return <p className="muted">{empty}</p>;
  }

  return (
    <div className="item-list">
      {memories.map((memory) => (
        <Link className="item project-row" href={memoryHref(memory)} key={String(memory._id ?? memoryTitle(memory))}>
          <span className="item-icon">
            <icons.BookOpen size={17} aria-hidden />
          </span>
          <div>
            <p className="item-title">{memoryTitle(memory)}</p>
            <p className="item-meta">
              {textValue(memory.memoryType, memory.status) || "memory"}
              {memory.updatedAt || memory.createdAt ? ` - ${formatDate(memory.updatedAt ?? memory.createdAt)}` : ""}
            </p>
            <p className="item-meta">{memorySummary(memory)}</p>
          </div>
          <span className="project-row-side">
            <span className="badge blue">{textValue(memory.memoryType) || "memory"}</span>
            <icons.ChevronRight size={18} aria-hidden />
          </span>
        </Link>
      ))}
    </div>
  );
}

function SourceList({ sourceRefs, empty }: { sourceRefs: AnyRecord[]; empty: string }) {
  if (sourceRefs.length === 0) {
    return <p className="muted">{empty}</p>;
  }

  return (
    <div className="item-list">
      {sourceRefs.map((sourceRef) => {
        const content = (
          <>
            <span className="item-icon">
              <icons.LinkIcon size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{sourceTitle(sourceRef)}</p>
              <p className="item-meta">{sourceMeta(sourceRef)}</p>
            </div>
            <span className="badge">{textValue(sourceRef.sourceSystem) || "source"}</span>
          </>
        );
        const href = textValue(sourceRef.deepLink, sourceRef.url);
        return href ? (
          <a className="item project-row" href={href} key={String(sourceRef._id ?? href)} rel="noreferrer" target="_blank">
            {content}
          </a>
        ) : (
          <article className="item" key={String(sourceRef._id ?? sourceTitle(sourceRef))}>
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
    <div className="toolbar" aria-label="Related entities">
      {entities.slice(0, 8).map((entity) => {
        const href = entityHref(entity.ref?.entityType, entity.ref?.entityId);
        const label = textValue(entity.title, entity.entity?.title, entity.entity?.name, entity.ref?.entityId) || "Related";
        return href ? (
          <Link className="badge blue" href={href} key={`${entity.ref?.entityType}:${entity.ref?.entityId}`}>
            {label}
          </Link>
        ) : (
          <span className="badge blue" key={`${entity.ref?.entityType}:${entity.ref?.entityId}:${label}`}>
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
    <section className="card section span-12">
      <div className="settings-row">
        <div>
          <h2>{textValue(project.title) || "Untitled project"}</h2>
          <p className="muted">{textValue(project.summary, project.priorityReason) || "Accepted project context."}</p>
        </div>
        <Link className="text-button compact" href={`/projects/${encodeURIComponent(String(project._id))}`}>
          Open
        </Link>
      </div>
      <div className="grid">
        <section className="span-6">
          <h3>Tasks</h3>
          {map.tasks?.length ? (
            <div className="item-list">
              {map.tasks.map((task: AnyRecord) => (
                <Link className="item project-row" href="/tasks" key={String(task._id)}>
                  <span className="item-icon">
                    <icons.Check size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">{textValue(task.title) || "Untitled task"}</p>
                    <p className="item-meta">{textValue(task.description, task.priorityReason, task.status) || "Accepted task"}</p>
                  </div>
                  <span className="badge blue">{textValue(task.status) || "task"}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No linked accepted tasks in this bounded map.</p>
          )}
        </section>
        <section className="span-6">
          <h3>Memories</h3>
          <MemoryList memories={map.memories ?? []} empty="No accepted memories linked to this project yet." />
        </section>
        <section className="span-12">
          <h3>Sources</h3>
          <SourceList sourceRefs={map.sourceRefs ?? []} empty="No source refs surfaced through linked memories yet." />
        </section>
      </div>
    </section>
  );
}

function ContactContextCard({ map }: { map: AnyRecord }) {
  return (
    <section className="card section span-6">
      <div className="settings-row">
        <div>
          <h2>{textValue(map.title, map.entity?.name) || "Untitled contact"}</h2>
          <p className="muted">{textValue(map.summary, map.entity?.relationshipContext, map.entity?.notes) || "Accepted contact context."}</p>
        </div>
        <Link className="text-button compact" href="/contacts">
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
    <section className="card section span-6">
      <div className="settings-row">
        <div>
          <h2>{memoryTitle(question)}</h2>
          <p className="muted">{memorySummary(question)}</p>
        </div>
        <Link className="text-button compact" href={memoryHref(question)}>
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
      <div className="grid">
        <section className="card section span-12">
          <form
            className="split-list"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(draftQuery);
            }}
          >
            <label className="field">
              <span>Question or phrase</span>
              <input
                className="input"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Search accepted memory context"
              />
            </label>
            <div className="toolbar checkbox-field-bottom">
              <button className="text-button" type="submit">
                Search
              </button>
              {submittedQuery ? (
                <button
                  className="text-button"
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
          <section className="card section span-12">
            <h2>Loading context map</h2>
            <p className="muted">Collecting bounded project, contact, memory, and source context from Convex.</p>
          </section>
        ) : !hasAnyMap ? (
          <section className="card section span-12">
            <h2>No context links yet</h2>
            <p className="muted">Accepted projects, contacts, questions, memories, and source refs will appear here after ingestion links them.</p>
          </section>
        ) : (
          <>
            {submittedQuery ? (
              <section className="card section span-12">
                <div className="settings-row">
                  <div>
                    <h2>Question matches</h2>
                    <p className="muted">Accepted memories and source refs matching "{submittedQuery.trim()}".</p>
                  </div>
                  <span className="badge blue">{data.queryMatches?.length ?? 0} memories</span>
                </div>
                <MemoryList memories={data.queryMatches ?? []} empty="No accepted memories matched that question." />
                <h3>Sources</h3>
                <SourceList sourceRefs={data.querySourceRefs ?? []} empty="No source refs matched through those memories." />
              </section>
            ) : null}

            <section className="span-12">
              <div className="settings-row">
                <div>
                  <h2>Projects</h2>
                  <p className="muted">Accepted projects with linked tasks, memories, and source refs.</p>
                </div>
                <span className="badge">{data.projects?.length ?? 0}</span>
              </div>
            </section>
            {(data.projects ?? []).map((map: AnyRecord) => (
              <ProjectContextCard key={String(map.project?._id ?? map.project?.title)} map={map} />
            ))}

            <section className="span-12">
              <div className="settings-row">
                <div>
                  <h2>People and companies</h2>
                  <p className="muted">Accepted contacts with nearby memories and evidence.</p>
                </div>
                <span className="badge">{data.contacts?.length ?? 0}</span>
              </div>
            </section>
            {(data.contacts ?? []).map((map: AnyRecord) => (
              <ContactContextCard key={`${map.ref?.entityType}:${map.ref?.entityId}`} map={map} />
            ))}

            <section className="span-12">
              <div className="settings-row">
                <div>
                  <h2>Questions</h2>
                  <p className="muted">Accepted questions with shared memory context and source refs.</p>
                </div>
                <span className="badge">{data.questions?.length ?? 0}</span>
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
