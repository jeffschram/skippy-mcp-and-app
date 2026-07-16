"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { activeSourceSyncStatus } from "@skippy/shared";
import { api } from "../lib/skippy-api";
import { focusItemKey, focusSummaryBullets, focusSummaryPresentation } from "./focus-summary";
import { LiveGate } from "./live-auth";
import { icons } from "./ui";
import { IconButton, InlineMarkdown, useToast } from "./components";

type AnyRecord = Record<string, any>;
type MergeOption = AnyRecord & {
  entityId: string;
  entityType: string;
  title: string;
  summary?: string;
  status?: string;
  matchScore: number;
};

const entityTypes = ["goal", "project", "task", "note", "person", "company", "link", "knowledgeObject"] as const;

const statusOptions: Record<string, string[]> = {
  goal: ["active", "paused", "achieved", "abandoned"],
  project: ["idea", "planned", "in_progress", "paused", "completed", "cancelled", "archived"],
  task: ["todo", "in_progress", "waiting", "done", "cancelled"],
  link: ["unread", "read", "saved", "discarded"],
};

function useViewerReady() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: AnyRecord | null }
    | null
    | undefined;

  return Boolean(viewer?.brain);
}

function titleForReviewItem(item: AnyRecord) {
  const payload = item.candidatePayload ?? {};
  return payload.title ?? payload.name ?? payload.url ?? payload.body ?? "Untitled signal";
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function editablePayloadFor(type: string, payload: AnyRecord) {
  switch (type) {
    case "goal":
      return {
        title: textValue(payload.title, payload.name, payload.summary),
        description: textValue(payload.description, payload.summary, payload.sourceSummary),
        status: textValue(payload.status) || "active",
      };
    case "project":
      return {
        title: textValue(payload.title, payload.name, payload.summary),
        summary: textValue(payload.summary, payload.description, payload.sourceSummary),
        status: textValue(payload.status) || "idea",
        priorityReason: textValue(payload.priorityReason),
      };
    case "task":
      return {
        title: textValue(payload.title, payload.name, payload.summary),
        description: textValue(payload.description, payload.summary),
        status: textValue(payload.status) || "todo",
        ownerType: textValue(payload.ownerType, payload.taskOwner, payload.assignedTo, payload.assignee),
        dueDate: textValue(payload.dueDate, payload.due, payload.start),
        sourceSummary: textValue(payload.sourceSummary),
        priorityReason: textValue(payload.priorityReason),
      };
    case "note":
      return {
        title: textValue(payload.title),
        body: textValue(payload.body, payload.text, payload.summary, payload.sourceSummary, payload.title),
      };
    case "person":
      return {
        name: textValue(payload.name, payload.personName, payload.title),
        email: textValue(payload.email, Array.isArray(payload.emails) ? payload.emails[0] : undefined),
        relationshipContext: textValue(payload.relationshipContext, payload.relationshipLabel, payload.sourceSummary),
        notes: textValue(payload.notes, payload.summary),
      };
    case "company":
      return {
        name: textValue(payload.name, payload.companyName, payload.title),
        website: textValue(payload.website, payload.url),
        relationshipLabel: textValue(payload.relationshipLabel) || "other",
        notes: textValue(payload.notes, payload.summary, payload.sourceSummary),
      };
    case "link":
      return {
        url: textValue(payload.url, payload.deepLink),
        title: textValue(payload.title),
        summary: textValue(payload.summary, payload.sourceSummary),
        whyItMatters: textValue(payload.whyItMatters, payload.priorityReason),
        // Approving a candidate marks it valid reference material, not read-later homework.
        status: textValue(payload.status) || "saved",
      };
    case "knowledgeObject":
      return {
        objectType: textValue(payload.objectType, payload.type) || "general",
        title: textValue(payload.title, payload.name, payload.summary),
        summary: textValue(payload.summary, payload.description, payload.sourceSummary),
      };
    default:
      return { ...payload };
  }
}

function compactPayload(payload: AnyRecord) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== ""));
}

function displayLabelsFrom(data: AnyRecord | undefined) {
  return {
    ownerName: textValue(data?.displayLabels?.ownerName, data?.user?.displayName, data?.user?.name) || "Owner",
    agentName:
      textValue(data?.displayLabels?.agentName, data?.config?.assistantDisplayName, data?.brain?.displayName) ||
      "Agent",
  };
}

function words(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function overlapScore(left: string, right: string) {
  const leftWords = words(left);
  const rightWords = words(right);
  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftWords.size, rightWords.size);
}

function candidateMatchText(item: AnyRecord, payload: AnyRecord) {
  return [
    titleForReviewItem(item),
    payload.title,
    payload.name,
    payload.email,
    payload.url,
    payload.summary,
    payload.description,
    payload.body,
    payload.sourceSummary,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
}

function matchOptions(item: AnyRecord, payload: AnyRecord, targetEntityType: string, entityOptions: AnyRecord[]): MergeOption[] {
  const candidateText = candidateMatchText(item, payload);
  return entityOptions
    .filter((option): option is AnyRecord & { entityId: string; entityType: string; title: string } =>
      option.entityType === targetEntityType && typeof option.entityId === "string" && typeof option.title === "string",
    )
    .map((option) => ({
      ...option,
      matchScore: overlapScore(candidateText, [option.title, option.summary, option.status].filter(Boolean).join(" ")),
    }))
    .sort((left, right) => right.matchScore - left.matchScore || String(left.title).localeCompare(String(right.title)));
}

function textOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatDate(value?: number) {
  if (!value) {
    return "never";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatJson(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function formatRunDuration(run: AnyRecord) {
  if (!run.completedAt) {
    return "still running";
  }
  const seconds = Math.max(0, Math.round((run.completedAt - run.startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.round(seconds / 60)}m`;
}

export function LiveHomeContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.dashboardForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const recordFocusItemAction = useMutation(api.knowledge.recordFocusItemActionForViewer);
  const createTaskFromFocusItem = useMutation(api.knowledge.createTaskFromFocusItemForViewer);
  const [busyFocusItemKey, setBusyFocusItemKey] = useState<string | null>(null);
  const focusBullets = useMemo(() => focusSummaryBullets(data?.focusSummary?.summaryText), [data?.focusSummary?.summaryText]);
  const { heading: focusHeading, details: focusDetails } = useMemo(
    () => focusSummaryPresentation(focusBullets),
    [focusBullets],
  );
  // Stale running rows (dead harness, no heartbeat) read as inactive — the
  // "Updating" pill self-heals instead of pinning forever.
  const sourceSyncStatus = useMemo(
    () => activeSourceSyncStatus<AnyRecord>(data?.sourceSyncStatuses, Date.now()),
    [data?.sourceSyncStatuses],
  );
  const focusActionByKey = useMemo(() => {
    const lookup = new Map<string, AnyRecord>();
    for (const action of data?.focusItemActions ?? []) {
      lookup.set(action.itemKey, action);
    }
    return lookup;
  }, [data?.focusItemActions]);
  const visibleFocusDetails = useMemo(
    () =>
      focusDetails
        .map((text) => ({ text, itemKey: focusItemKey(text) }))
        .filter((item) => !focusActionByKey.has(item.itemKey)),
    [focusActionByKey, focusDetails],
  );
  const displayedFocusHeading = visibleFocusDetails.length ? focusHeading : "Nothing new needs focus right now.";
  const unclearSignalCount = data?.triageItems.length ?? 0;
  const pendingActionCount = data?.pendingActions.length ?? 0;
  const hasDecisionQueueItems = unclearSignalCount > 0 || pendingActionCount > 0;
  const recordFocusAction = async (item: { text: string; itemKey: string }, action: "dismissed" | "done") => {
    if (!data?.focusSummary?._id) {
      return;
    }
    setBusyFocusItemKey(item.itemKey);
    try {
      await recordFocusItemAction({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.itemKey,
        itemText: item.text,
        action,
      } as any);
    } finally {
      setBusyFocusItemKey(null);
    }
  };
  const promoteFocusItemToTask = async (item: { text: string; itemKey: string }) => {
    if (!data?.focusSummary?._id) {
      return;
    }
    setBusyFocusItemKey(item.itemKey);
    try {
      await createTaskFromFocusItem({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.itemKey,
        itemText: item.text,
      } as any);
    } finally {
      setBusyFocusItemKey(null);
    }
  };

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading focus</h2>
          <p className="muted">Waiting for the latest Convex snapshot.</p>
        </section>
      ) : (
        <div className="grid">
          <section className={`card section ${hasDecisionQueueItems ? "span-8" : "span-12"} focus-summary`}>
            <div>
              <div className="focus-summary-head">
                <p className="eyebrow">Now</p>
                {sourceSyncStatus ? (
                  <span className="sync-status-pill" title={sourceSyncStatus.message ?? "Source sync is running"}>
                    <icons.RefreshCw size={14} aria-hidden />
                    Updating
                  </span>
                ) : null}
              </div>
              {sourceSyncStatus ? (
                <p className="sync-status-copy">
                  {sourceSyncStatus.message ??
                    `Checking ${(sourceSyncStatus.sourceSystemsChecked ?? []).join(", ") || "connected sources"}.`}
                </p>
              ) : null}
              <h1 className="focus-heading">
                <InlineMarkdown>{displayedFocusHeading}</InlineMarkdown>
              </h1>
              {visibleFocusDetails.length ? (
                <ul className="focus-summary-list">
                  {visibleFocusDetails.map((item) => (
                    <li key={item.itemKey}>
                      <span>
                        <InlineMarkdown>{item.text}</InlineMarkdown>
                      </span>
                      <span className="focus-item-actions">
                        <button
                          className="icon-button"
                          type="button"
                          title="Dismiss from focus"
                          aria-label={`Dismiss ${item.text}`}
                          disabled={busyFocusItemKey === item.itemKey}
                          onClick={() => void recordFocusAction(item, "dismissed")}
                        >
                          <icons.X size={16} aria-hidden />
                        </button>
                        <button
                          className="text-button compact"
                          type="button"
                          title="Turn into task"
                          disabled={busyFocusItemKey === item.itemKey}
                          onClick={() => void promoteFocusItemToTask(item)}
                        >
                          Task
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Already done"
                          aria-label={`Mark ${item.text} already done`}
                          disabled={busyFocusItemKey === item.itemKey}
                          onClick={() => void recordFocusAction(item, "done")}
                        >
                          <icons.Check size={16} aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">New source items and remaining focus bullets will appear here when they need attention.</p>
              )}
            </div>
          </section>
          {hasDecisionQueueItems ? (
            <section className="span-4 section">
              <h2>Decision queue</h2>
              <div className="item-list">
                {unclearSignalCount > 0 ? (
                  <div className="item">
                    <span className="item-icon">
                      <icons.Archive size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{unclearSignalCount} unclear signals</p>
                      <p className="item-meta">Fallback items that need a rubric decision.</p>
                    </div>
                    <span className="badge gold">Review</span>
                  </div>
                ) : null}
                {pendingActionCount > 0 ? (
                  <div className="item">
                    <span className="item-icon">
                      <icons.MessageSquareText size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{pendingActionCount} pending actions</p>
                      <p className="item-meta">External effects stay separated until reviewed.</p>
                    </div>
                    <span className="badge red">Approval</span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveProjectsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.projectsAndTasksForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of data?.tasks ?? []) {
      if (task.projectId) {
        counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
      }
    }
    return counts;
  }, [data?.tasks]);

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading projects</h2>
        </section>
      ) : data.projects.length === 0 ? (
        <p className="muted">No accepted projects yet.</p>
      ) : (
        <div className="item-list">
          {data.projects.map((project: AnyRecord) => (
            <ProjectRow
              key={project._id}
              href={`/projects/${project._id}`}
              project={project}
              taskCount={taskCountByProject.get(project._id) ?? 0}
            />
          ))}
        </div>
      )}
    </LiveGate>
  );
}

function ProjectRow({ href, project, taskCount }: { href: string; project: AnyRecord; taskCount: number }) {
  return (
    <Link className="item project-row" href={href}>
      <span className="item-icon">
        <icons.BriefcaseBusiness size={17} aria-hidden />
      </span>
      <div>
        <p className="item-title">{project.title}</p>
        <p className="item-meta">
          {project.summary ?? "No summary yet."}
          {" · "}
          {taskCount} open task{taskCount === 1 ? "" : "s"}
        </p>
      </div>
      <span className="project-row-side">
        <span className="badge blue">{project.status}</span>
        <icons.ChevronRight size={18} aria-hidden />
      </span>
    </Link>
  );
}

export function LiveIngestionLogsContent() {
  const viewerReady = useViewerReady();
  const runs = useQuery(api.knowledge.ingestionRunsForViewer, viewerReady ? { limit: 50 } : "skip") as AnyRecord[] | undefined;

  return (
    <LiveGate>
      {!runs ? (
        <section className="card section">
          <h2>Loading ingestion logs</h2>
        </section>
      ) : runs.length === 0 ? (
        <p className="muted">No ingestion runs have been recorded yet.</p>
      ) : (
        <div className="item-list">
          {runs.map((run) => (
            <Link className="item project-row" href={`/ingestion-logs/${run._id}`} key={run._id}>
              <span className={`item-icon ${run.status === "running" ? "is-active" : ""}`}>
                <icons.Archive size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{run.harness}</p>
                <p className="item-meta">
                  {formatDate(run.startedAt)}
                  {" · "}
                  {(run.sourceSystemsChecked ?? []).join(", ") || "no sources recorded"}
                  {" · "}
                  {formatRunDuration(run)}
                </p>
              </div>
              <span className="project-row-side">
                <span className={`badge ${run.status === "failed" ? "red" : run.status === "running" ? "gold" : "blue"}`}>
                  {run.status}
                </span>
                <icons.ChevronRight size={18} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveIngestionLogDetailContent({ ingestionRunId }: { ingestionRunId: string }) {
  const viewerReady = useViewerReady();
  const data = useQuery(
    api.knowledge.ingestionRunDetailForViewer,
    viewerReady ? { ingestionRunId: ingestionRunId as any } : "skip",
  ) as AnyRecord | null | undefined;

  if (data === null) {
    return (
      <section className="card section">
        <h2>Log not found</h2>
        <p className="muted">
          This ingestion log may have been removed. <Link href="/ingestion-logs">Back to ingestion logs</Link>.
        </p>
      </section>
    );
  }

  const run = data?.run;
  const activityEvents = data?.activityEvents ?? [];
  const sourceRefs = data?.sourceRefs ?? [];
  const auditSummary = data?.auditSummary ?? {};
  const memories = data?.memories ?? [];
  const entities = data?.entities ?? [];
  const ignoredItems = data?.ignoredItems ?? [];

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading ingestion log</h2>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-12">
            <div className="settings-row">
              <div>
                <h2>{run.harness}</h2>
                <p className="muted">
                  Started {formatDate(run.startedAt)}
                  {run.completedAt ? ` · Completed ${formatDate(run.completedAt)}` : " · Still running"}
                  {" · "}
                  {formatRunDuration(run)}
                </p>
              </div>
              <span className={`badge ${run.status === "failed" ? "red" : run.status === "running" ? "gold" : "blue"}`}>
                {run.status}
              </span>
            </div>
            <div className="toolbar">
              {(run.sourceSystemsChecked ?? []).map((source: string) => (
                <span className="badge" key={source}>
                  {source}
                </span>
              ))}
            </div>
          </section>

          <section className="card section span-12">
            <h2>Counts</h2>
            <div className="toolbar">
              <span className="badge blue">{run.objectsCreated ?? 0} created</span>
              <span className="badge blue">{run.objectsUpdated ?? 0} updated</span>
              <span className="badge gold">{run.candidatesSubmitted ?? 0} review candidates</span>
              <span className={`badge ${run.errors?.length ? "red" : "blue"}`}>{run.errors?.length ?? 0} errors</span>
            </div>
            {run.errors?.length ? (
              <div className="item-list">
                {run.errors.map((error: string) => (
                  <p className="muted" key={error}>
                    {error}
                  </p>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card section span-12">
            <h2>Audit trail</h2>
            <div className="toolbar">
              <span className="badge blue">{auditSummary.capturedDirect ?? 0} captured</span>
              <span className="badge gold">{auditSummary.sentToReview ?? 0} sent to review</span>
              <span className="badge blue">{auditSummary.linked ?? 0} linked</span>
              <span className="badge blue">{auditSummary.updated ?? 0} updated</span>
              <span className={`badge ${(auditSummary.rejected ?? 0) > 0 ? "red" : "blue"}`}>{auditSummary.rejected ?? 0} rejected</span>
              <span className="badge">{auditSummary.ignored ?? 0} ignored</span>
            </div>
            {memories.length || entities.length ? (
              <div className="item-list">
                {memories.map((memory: AnyRecord) => (
                  <Link className="item project-row" href={memoryHref(memory)} key={memory._id}>
                    <span className="item-icon">
                      <icons.Brain size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{memoryTitle(memory)}</p>
                      <p className="item-meta">
                        {memoryKind(memory)}
                        {" · "}
                        {memoryState(memory)}
                      </p>
                      {memory.rubricDecision ? <p className="item-meta">Decision: {memory.rubricDecision}</p> : null}
                      {memory.captureReason ? <p className="item-meta">Capture: {memory.captureReason}</p> : null}
                    </div>
                    <span className="project-row-side">
                      <span className={`badge ${badgeColorForState(memoryState(memory))}`}>{memoryState(memory)}</span>
                      <icons.ChevronRight size={18} aria-hidden />
                    </span>
                  </Link>
                ))}
                {entities.map((entry: AnyRecord) => {
                  const entity = entry.entity ?? entry;
                  return (
                    <article className="item" key={`${entry.ref?.entityType ?? entity.entityType}:${entry.ref?.entityId ?? entity._id}`}>
                      <span className="item-icon">
                        <icons.Archive size={17} aria-hidden />
                      </span>
                      <div>
                        <p className="item-title">{relatedEntityTitle(entry)}</p>
                        <p className="item-meta">{relatedEntityMeta(entry)}</p>
                        {entity.priorityReason ? <p className="item-meta">{entity.priorityReason}</p> : null}
                      </div>
                      <span className="badge blue">{entry.ref?.entityType ?? entity.entityType ?? "entity"}</span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No created or linked Skippy entities were detected for this run.</p>
            )}
            {ignoredItems.length ? (
              <details>
                <summary className="item-title">Ignored or skipped items</summary>
                <pre className="code rubric-rendered-text">{formatJson(ignoredItems)}</pre>
              </details>
            ) : null}
          </section>

          <section className="card section span-12">
            <h2>Activity</h2>
            {activityEvents.length === 0 ? (
              <p className="muted">No activity events were linked to this run or found in its time window.</p>
            ) : (
              <div className="item-list">
                {activityEvents.map((event: AnyRecord) => (
                  <article className="item" key={event._id}>
                    <span className="item-icon">
                      <icons.Clock3 size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{event.summary}</p>
                      <p className="item-meta">
                        {event.activityType}
                        {" · "}
                        {formatDate(event.timestamp)}
                      </p>
                      {event.metadata?.rubricDecision ? (
                        <p className="item-meta">Decision: {event.metadata.rubricDecision}</p>
                      ) : null}
                    </div>
                    <span className="badge">{event.actorType}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="card section span-12">
            <h2>Source refs</h2>
            {sourceRefs.length === 0 ? (
              <p className="muted">No source references were linked to this run.</p>
            ) : (
              <div className="item-list">
                {sourceRefs.map((sourceRef: AnyRecord) => (
                  <article className="item" key={sourceRef._id}>
                    <span className="item-icon">
                      <icons.LinkIcon size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{sourceRef.summary ?? sourceRef.excerpt ?? sourceRef.externalId ?? sourceRef.sourceSystem}</p>
                      <p className="item-meta">
                        {sourceRef.sourceSystem}
                        {sourceRef.sourceTimestamp ? ` · ${formatDate(sourceRef.sourceTimestamp)}` : ""}
                      </p>
                      {sourceRef.participants?.length ? (
                        <p className="item-meta">Participants: {sourceRef.participants.join(", ")}</p>
                      ) : null}
                    </div>
                    <span className="badge">{sourceRef.messageId ?? sourceRef.eventId ?? sourceRef.threadId ?? "source"}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          {run.metadata ? (
            <section className="card section span-12">
              <h2>Run metadata</h2>
              <pre className="code rubric-rendered-text">{formatJson(run.metadata)}</pre>
            </section>
          ) : null}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveProjectDetailContent({ projectId }: { projectId: string }) {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.projectsAndTasksForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const markDoneMutation = useMutation(api.knowledge.markTaskDoneForViewer);
  const startAgentTaskMutation = useMutation(api.knowledge.markTaskInProgressForViewer);
  const markDone = async (args: AnyRecord) => markDoneMutation({ taskId: args.taskId as any });
  const startAgentTask = async (args: AnyRecord) =>
    startAgentTaskMutation({ taskId: args.taskId as any, startedBy: displayLabels.agentName });
  const displayLabels = displayLabelsFrom(data);
  const project = useMemo(
    () => data?.projects?.find((candidate: AnyRecord) => candidate._id === projectId),
    [data?.projects, projectId],
  );
  const tasks = useMemo(
    () => (data?.tasks ?? []).filter((task: AnyRecord) => task.projectId === projectId),
    [data?.tasks, projectId],
  );

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading project</h2>
        </section>
      ) : !project ? (
        <section className="card section">
          <h2>Project not found</h2>
          <p className="muted">
            This project may have been removed. <Link href="/projects">Back to projects</Link>.
          </p>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-12">
            <div className="settings-row">
              <div>
                <h2>{project.title}</h2>
                <p className="muted">{project.summary ?? "No summary yet."}</p>
              </div>
              <span className="badge blue">{project.status}</span>
            </div>
            {project.priorityReason ? <p className="muted">{project.priorityReason}</p> : null}
          </section>
          <section className="card section span-12">
            <h2>Tasks</h2>
            <TaskList
              tasks={tasks}
              markDone={markDone}
              startAgentTask={startAgentTask}
              displayLabels={displayLabels}
            />
          </section>
        </div>
      )}
    </LiveGate>
  );
}

export function LiveTasksContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.projectsAndTasksForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const markDoneMutation = useMutation(api.knowledge.markTaskDoneForViewer);
  const startAgentTaskMutation = useMutation(api.knowledge.markTaskInProgressForViewer);
  const markDone = async (args: AnyRecord) => markDoneMutation({ taskId: args.taskId as any });
  const startAgentTask = async (args: AnyRecord) =>
    startAgentTaskMutation({ taskId: args.taskId as any, startedBy: displayLabels.agentName });
  const displayLabels = displayLabelsFrom(data);
  const unassignedTasks = useMemo(
    () => (data?.tasks ?? []).filter((task: AnyRecord) => !task.projectId),
    [data?.tasks],
  );

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading tasks</h2>
        </section>
      ) : (
        <TaskList
          tasks={unassignedTasks}
          markDone={markDone}
          startAgentTask={startAgentTask}
          displayLabels={displayLabels}
        />
      )}
    </LiveGate>
  );
}

function taskOwnerLabel(ownerType: string | undefined, displayLabels: { ownerName: string; agentName: string }) {
  if (ownerType === "agent") {
    return displayLabels.agentName;
  }
  if (ownerType === "owner") {
    return displayLabels.ownerName;
  }
  return undefined;
}

function TaskList({
  tasks,
  markDone,
  startAgentTask,
  displayLabels,
}: {
  tasks: AnyRecord[];
  markDone: (args: AnyRecord) => Promise<unknown>;
  startAgentTask: (args: AnyRecord) => Promise<unknown>;
  displayLabels: { ownerName: string; agentName: string };
}) {
  if (tasks.length === 0) {
    return <p className="muted">No tasks here.</p>;
  }

  return (
    <div className="item-list">
      {tasks.map((task) => {
        const isAgentTask = task.ownerType === "agent";
        const isInProgress = task.status === "in_progress";
        const isDone = task.status === "done";
        const actionLabel = isAgentTask ? `Start ${displayLabels.agentName} task` : "Mark done";
        const actionDisabled = isDone || (isAgentTask && isInProgress);
        const action = isAgentTask ? startAgentTask : markDone;
        const ActionIcon = isAgentTask ? icons.Play : icons.CircleCheck;

        return (
          <article className="item task-item" key={task._id}>
            <span className={`item-icon ${isInProgress ? "is-active" : ""}`}>
              {isInProgress ? (
                <icons.Clock3 size={17} aria-hidden />
              ) : (
                <icons.Check size={17} aria-hidden />
              )}
            </span>
            <div>
              <p className="item-title">{task.title}</p>
              <p className="item-meta">
                {isInProgress ? `In progress${task.startedBy ? ` by ${task.startedBy}` : ""}` : (task.priorityReason ?? task.status)}
              </p>
            </div>
            <span className="task-side">
              {task.ownerType ? <span className="badge">{taskOwnerLabel(task.ownerType, displayLabels)}</span> : null}
              <span className={`badge ${isInProgress ? "gold" : "blue"}`}>{task.status}</span>
            </span>
            <button
              className="icon-button"
              type="button"
              title={actionLabel}
              aria-label={`${actionLabel}: ${task.title}`}
              disabled={actionDisabled}
              onClick={() => void action({ taskId: task._id })}
            >
              <ActionIcon size={17} aria-hidden />
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function LiveGoalsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.goalsForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const createGoal = useMutation(api.knowledge.createGoalForViewer);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const addGoal = async () => {
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    setBusy(true);
    try {
      await createGoal({ title } as any);
      setNewTitle("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading goals</h2>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-12">
            <h2>Add a goal</h2>
            <div className="toolbar">
              <input
                className="input"
                placeholder="New goal title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void addGoal();
                  }
                }}
              />
              <button className="text-button" type="button" disabled={busy || !newTitle.trim()} onClick={() => void addGoal()}>
                Add goal
              </button>
            </div>
          </section>
          <section className="span-12">
            {data.goals.length === 0 ? (
              <p className="muted">No goals yet. Add one above; active goals feed the importance rubric.</p>
            ) : (
              <div className="item-list">
                {data.goals.map((goal: AnyRecord) => (
                  <GoalRow key={goal._id} goal={goal} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </LiveGate>
  );
}

function GoalRow({ goal }: { goal: AnyRecord }) {
  const updateGoal = useMutation(api.knowledge.updateGoalForViewer);
  const save = (patch: AnyRecord) => void updateGoal({ goalId: goal._id, ...patch } as any);

  return (
    <article className="item">
      <span className={`item-icon ${goal.status === "achieved" ? "is-active" : ""}`}>
        <icons.Target size={17} aria-hidden />
      </span>
      <div className="form-grid compact-form">
        <input
          className="input"
          defaultValue={goal.title}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== goal.title) {
              save({ title: value });
            }
          }}
        />
        <textarea
          className="textarea"
          placeholder="Description"
          defaultValue={goal.description ?? ""}
          onBlur={(event) => {
            if (event.target.value !== (goal.description ?? "")) {
              save({ description: event.target.value });
            }
          }}
        />
      </div>
      <label className="field">
        <span>Status</span>
        <select className="select" defaultValue={goal.status} onChange={(event) => save({ status: event.target.value })}>
          {(statusOptions.goal ?? []).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {statusValue}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

export function LiveContactsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.contactsForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const setFavorite = useMutation(api.knowledge.setContactFavoriteForViewer);
  const toggleFavorite = (personId: string, favorite: boolean) =>
    void setFavorite({ personId: personId as any, favorite });

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading contacts</h2>
        </section>
      ) : (
        <div className="split-list">
          <ContactList
            title="People"
            items={data.people}
            icon="UserRound"
            labelField="name"
            onToggleFavorite={toggleFavorite}
          />
          <ContactList title="Companies" items={data.companies} icon="LinkIcon" labelField="name" />
        </div>
      )}
    </LiveGate>
  );
}

function ContactList({
  title,
  items,
  icon,
  labelField,
  onToggleFavorite,
}: {
  title: string;
  items: AnyRecord[];
  icon: "UserRound" | "LinkIcon";
  labelField: string;
  onToggleFavorite?: (id: string, favorite: boolean) => void;
}) {
  const Icon = icons[icon];
  return (
    <section>
      <h2>{title}</h2>
      <div className="item-list">
        {items.length === 0 ? <p className="muted">No accepted records yet.</p> : null}
        {items.map((item) => (
          <article className="item" key={item._id}>
            <span className="item-icon">
              <Icon size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{item[labelField]}</p>
              <p className="item-meta">{item.relationshipContext ?? item.notes ?? item.domain ?? "Accepted"}</p>
            </div>
            <span className="project-row-side">
              {onToggleFavorite ? (
                <button
                  className={`icon-button ${item.favorite ? "is-favorite" : ""}`}
                  type="button"
                  title={item.favorite ? "Unfavorite contact" : "Favorite contact"}
                  aria-pressed={Boolean(item.favorite)}
                  aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${item[labelField]}`}
                  onClick={() => onToggleFavorite(item._id, !item.favorite)}
                >
                  <icons.Star size={17} fill={item.favorite ? "currentColor" : "none"} aria-hidden />
                </button>
              ) : null}
              <span className="badge">{item.relationshipLabel ?? item.roleTitle ?? "Contact"}</span>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

const expectedMemoryApi = api.knowledge as AnyRecord;

// Expected backend queries:
// - knowledge.listMemoryInboxForViewer({ limit?, memoryType? }) -> memory[]
// - knowledge.listAcceptedMemoryLibraryForViewer({ limit?, memoryType? }) -> memory[]
// - knowledge.getMemoryDetailForViewer({ memoryId }) -> { memory, sourceRefs?, relatedEntities? } | null
type MemoryCollectionFilter = {
  objectTypes?: string[];
  emptyMessage?: string;
};

function arrayValue(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter((item): item is AnyRecord => Boolean(item) && typeof item === "object") : [];
}

function collectionItems(data: unknown): AnyRecord[] {
  if (Array.isArray(data)) {
    return arrayValue(data);
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as AnyRecord;
  return arrayValue(record.items ?? record.memories ?? record.objects ?? record.results);
}

function memoryTitle(memory: AnyRecord) {
  return textValue(memory.title, memory.name, memory.summary, memory.content, memory.body, memory.objectType) || "Untitled memory";
}

function memorySummary(memory: AnyRecord) {
  return textValue(memory.summary, memory.description, memory.body, memory.content, memory.excerpt) || "No summary yet.";
}

function memoryKind(memory: AnyRecord) {
  return textValue(memory.objectType, memory.memoryType, memory.type, memory.category, memory.entityType) || "memory";
}

function memoryState(memory: AnyRecord) {
  return textValue(memory.reviewState, memory.processingState, memory.status, memory.state) || "accepted";
}

function memoryReason(memory: AnyRecord) {
  return textValue(
    memory.captureReason,
    memory.reviewReason,
    memory.rubricDecision,
    memory.priorityReason,
    memory.whyItMatters,
  );
}

function badgeColorForState(state: string) {
  if (/reject|error|archiv|discard/i.test(state)) {
    return "red";
  }
  if (/suggest|pending|review|draft/i.test(state)) {
    return "gold";
  }
  return "blue";
}

function memoryHref(memory: AnyRecord) {
  const id = textValue(memory._id, memory.id, memory.memoryId, memory.entityId);
  return id ? `/memory/${encodeURIComponent(id)}` : "/memory";
}

function sourceRefTitle(sourceRef: AnyRecord) {
  return (
    textValue(sourceRef.summary, sourceRef.excerpt, sourceRef.title, sourceRef.externalId, sourceRef.messageId, sourceRef.eventId) ||
    "Source reference"
  );
}

function sourceRefMeta(sourceRef: AnyRecord) {
  const sourceSystem = textValue(sourceRef.sourceSystem, sourceRef.provider, sourceRef.system) || "source";
  return `${sourceSystem}${sourceRef.sourceTimestamp ? ` · ${formatDate(sourceRef.sourceTimestamp)}` : ""}`;
}

function relatedEntityTitle(entity: AnyRecord) {
  const nestedEntity = entity.entity && typeof entity.entity === "object" ? (entity.entity as AnyRecord) : undefined;
  const ref = entity.ref && typeof entity.ref === "object" ? (entity.ref as AnyRecord) : undefined;
  return textValue(nestedEntity?.title, nestedEntity?.name, entity.title, entity.name, ref?.entityId, entity.entityId, entity.id) || "Related entity";
}

function relatedEntityMeta(entity: AnyRecord) {
  const ref = entity.ref && typeof entity.ref === "object" ? (entity.ref as AnyRecord) : undefined;
  return textValue(ref?.entityType, entity.entityType, entity.type, entity.relationship, entity.reason) || "related";
}

// Mirrors MEMORY_REVIEW_EXPIRY_MS in convex/knowledge.ts; the server enforces its own default.
const MEMORY_REVIEW_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

function memoryIsPendingReview(memory: AnyRecord) {
  return memory.reviewState === "pending_review";
}

function MemoryReviewActions({ memory, small }: { memory: AnyRecord; small?: boolean }) {
  const toast = useToast();
  const acceptMemory = useMutation(expectedMemoryApi.acceptMemoryForViewer);
  const rejectMemory = useMutation(expectedMemoryApi.rejectMemoryForViewer);
  const [busy, setBusy] = useState(false);
  const title = memoryTitle(memory);
  const memoryId = textValue(memory._id, memory.id);

  const resolve = async (event: MouseEvent, action: "accept" | "reject") => {
    event.preventDefault();
    event.stopPropagation();
    if (!memoryId || busy) {
      return;
    }
    setBusy(true);
    try {
      if (action === "accept") {
        await acceptMemory({ memoryId: memoryId as any });
        toast(`Memory accepted: ${title}`, "success");
      } else {
        await rejectMemory({ memoryId: memoryId as any });
        toast(`Memory rejected: ${title}`, "success");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : `Could not ${action} memory.`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        small={small ?? false}
        title="Accept memory"
        aria-label={`Accept ${title}`}
        disabled={busy}
        onClick={(event) => void resolve(event, "accept")}
      >
        <icons.Check size={15} aria-hidden />
      </IconButton>
      <IconButton
        small={small ?? false}
        title="Reject memory"
        aria-label={`Reject ${title}`}
        disabled={busy}
        onClick={(event) => void resolve(event, "reject")}
      >
        <icons.X size={15} aria-hidden />
      </IconButton>
    </>
  );
}

function MemoryRow({ memory, variant = "memory" }: { memory: AnyRecord; variant?: "inbox" | "memory" }) {
  const state = memoryState(memory);
  const reason = memoryReason(memory);
  const sourceRefs = arrayValue(memory.sourceRefs ?? memory.sources);
  const sourceRefIds = Array.isArray(memory.sourceRefIds) ? memory.sourceRefIds : [];

  return (
    <Link className="item project-row" href={memoryHref(memory)}>
      <span className={`item-icon ${variant === "inbox" ? "is-active" : ""}`}>
        {variant === "inbox" ? <icons.Brain size={17} aria-hidden /> : <icons.BookOpen size={17} aria-hidden />}
      </span>
      <div className="form-grid">
        <div>
          <p className="item-title">{memoryTitle(memory)}</p>
          <p className="item-meta">
            {memoryKind(memory)}
            {memory.confidence ? ` · ${Math.round(Number(memory.confidence) * 100)}% confidence` : ""}
            {memory.updatedAt || memory.createdAt ? ` · ${formatDate(memory.updatedAt ?? memory.createdAt)}` : ""}
          </p>
        </div>
        <p className="item-meta">{memorySummary(memory)}</p>
        {reason ? <p className="item-meta">Capture: {reason}</p> : null}
        <InlineSourceRefs sourceRefs={sourceRefs} sourceRefIds={sourceRefIds} />
        <InlineRelatedEntities entities={arrayValue(memory.relatedEntities)} />
      </div>
      <span className="project-row-side">
        {variant === "inbox" && memoryIsPendingReview(memory) ? <MemoryReviewActions memory={memory} small /> : null}
        <span className={`badge ${badgeColorForState(state)}`}>{state}</span>
        <icons.ChevronRight size={18} aria-hidden />
      </span>
    </Link>
  );
}

function InlineSourceRefs({ sourceRefs, sourceRefIds }: { sourceRefs: AnyRecord[]; sourceRefIds?: unknown[] }) {
  if (sourceRefs.length === 0 && (!sourceRefIds || sourceRefIds.length === 0)) {
    return <p className="item-meta">No source references attached.</p>;
  }

  return (
    <div className="toolbar" aria-label="Source references">
      {sourceRefs.slice(0, 4).map((sourceRef) => (
        <span className="badge" key={textValue(sourceRef._id, sourceRef.id, sourceRef.externalId, sourceRefTitle(sourceRef))}>
          {textValue(sourceRef.sourceSystem, sourceRef.provider) || "source"}
        </span>
      ))}
      {sourceRefs.length === 0
        ? sourceRefIds?.slice(0, 4).map((sourceRefId) => (
            <span className="badge" key={String(sourceRefId)}>
              source
            </span>
          ))
        : null}
    </div>
  );
}

function InlineRelatedEntities({ entities }: { entities: AnyRecord[] }) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <div className="toolbar" aria-label="Related entities">
      {entities.slice(0, 5).map((entity) => (
        <span className="badge blue" key={textValue(entity.entityId, entity.id, entity._id, relatedEntityTitle(entity))}>
          {relatedEntityTitle(entity)}
        </span>
      ))}
    </div>
  );
}

function SourceRefList({ sourceRefs }: { sourceRefs: AnyRecord[] }) {
  if (sourceRefs.length === 0) {
    return <p className="muted">No source references were returned for this memory.</p>;
  }

  return (
    <div className="item-list">
      {sourceRefs.map((sourceRef) => (
        <article className="item" key={textValue(sourceRef._id, sourceRef.id, sourceRef.externalId, sourceRefTitle(sourceRef))}>
          <span className="item-icon">
            <icons.LinkIcon size={17} aria-hidden />
          </span>
          <div>
            <p className="item-title">{sourceRefTitle(sourceRef)}</p>
            <p className="item-meta">{sourceRefMeta(sourceRef)}</p>
            {sourceRef.participants?.length ? <p className="item-meta">Participants: {sourceRef.participants.join(", ")}</p> : null}
          </div>
          <span className="badge">{textValue(sourceRef.messageId, sourceRef.eventId, sourceRef.threadId, sourceRef.externalId) || "source"}</span>
        </article>
      ))}
    </div>
  );
}

function RelatedEntityList({ entities }: { entities: AnyRecord[] }) {
  if (entities.length === 0) {
    return <p className="muted">No related entities were returned yet.</p>;
  }

  return (
    <div className="item-list">
      {entities.map((entity) => (
        <article className="item" key={textValue(entity.entityId, entity.id, entity._id, relatedEntityTitle(entity))}>
          <span className="item-icon">
            <icons.LinkIcon size={17} aria-hidden />
          </span>
          <div>
            <p className="item-title">{relatedEntityTitle(entity)}</p>
            <p className="item-meta">{relatedEntityMeta(entity)}</p>
          </div>
          <span className="badge blue">{textValue(entity.entityType, entity.type) || "entity"}</span>
        </article>
      ))}
    </div>
  );
}

export function LiveMemoryInboxContent() {
  const viewerReady = useViewerReady();
  const toast = useToast();
  const data = useQuery(expectedMemoryApi.listMemoryInboxForViewer, viewerReady ? { limit: 50 } : "skip") as
    | AnyRecord
    | AnyRecord[]
    | undefined;
  const items = collectionItems(data);
  const expireStaleCandidates = useMutation(expectedMemoryApi.expireStaleMemoryCandidatesForViewer);
  const bulkResolveCandidates = useMutation(expectedMemoryApi.bulkResolveMemoryCandidatesForViewer);
  const [bulkBusy, setBulkBusy] = useState(false);

  const hasStaleCandidates = items.some(
    (memory) =>
      memoryIsPendingReview(memory) &&
      typeof memory.createdAt === "number" &&
      memory.createdAt < Date.now() - MEMORY_REVIEW_EXPIRY_MS,
  );

  const expiryTriggered = useRef(false);
  useEffect(() => {
    if (!viewerReady || !hasStaleCandidates || expiryTriggered.current) {
      return;
    }
    expiryTriggered.current = true;
    void (async () => {
      try {
        const result = (await expireStaleCandidates({})) as AnyRecord | undefined;
        const expiredCount = Number(result?.expiredCount ?? 0);
        if (expiredCount > 0) {
          toast(`Auto-archived ${expiredCount} stale review ${expiredCount === 1 ? "candidate" : "candidates"}.`);
        }
      } catch {
        // Auto-expiry is best-effort; the inbox stays usable if it fails.
      }
    })();
  }, [viewerReady, hasStaleCandidates, expireStaleCandidates, toast]);

  const bulkResolve = async (resolution: "accept" | "archive") => {
    if (bulkBusy) {
      return;
    }
    setBulkBusy(true);
    try {
      const result = (await bulkResolveCandidates({ resolution })) as AnyRecord | undefined;
      const resolvedCount = Number(result?.resolvedCount ?? 0);
      toast(
        resolution === "accept"
          ? `Accepted ${resolvedCount} review ${resolvedCount === 1 ? "candidate" : "candidates"}.`
          : `Archived ${resolvedCount} review ${resolvedCount === 1 ? "candidate" : "candidates"}.`,
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Bulk action failed.", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const pendingCount = items.filter((memory) => memoryIsPendingReview(memory)).length;

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading memory inbox</h2>
          <p className="muted">Waiting for suggested memories and review states from Convex.</p>
        </section>
      ) : items.length === 0 ? (
        <section className="card section">
          <h2>Inbox clear</h2>
          <p className="muted">No captured memory objects need review right now.</p>
        </section>
      ) : (
        <>
          {pendingCount > 0 ? (
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <button
                className="text-button compact"
                type="button"
                disabled={bulkBusy}
                onClick={() => void bulkResolve("accept")}
              >
                Accept all
              </button>
              <button
                className="text-button compact"
                type="button"
                disabled={bulkBusy}
                onClick={() => void bulkResolve("archive")}
              >
                Archive all
              </button>
              <span className="muted">
                Unreviewed candidates auto-archive after {Math.round(MEMORY_REVIEW_EXPIRY_MS / (24 * 60 * 60 * 1000))} days.
              </span>
            </div>
          ) : null}
          <div className="item-list">
            {items.map((memory) => (
              <MemoryRow key={textValue(memory._id, memory.id, memoryTitle(memory))} memory={memory} variant="inbox" />
            ))}
          </div>
        </>
      )}
    </LiveGate>
  );
}

export function LiveMemoryContent({ objectTypes, emptyMessage }: MemoryCollectionFilter = {}) {
  const viewerReady = useViewerReady();
  const memoryType = objectTypes?.length === 1 ? objectTypes[0] : undefined;
  const data = useQuery(
    expectedMemoryApi.listAcceptedMemoryLibraryForViewer,
    viewerReady ? { memoryType, limit: 100 } : "skip",
  ) as AnyRecord | AnyRecord[] | undefined;
  const items = collectionItems(data);
  const counts = !Array.isArray(data) && data && typeof data === "object" ? arrayValue((data as AnyRecord).counts) : [];

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading memory</h2>
          <p className="muted">Waiting for accepted memory objects from Convex.</p>
        </section>
      ) : (
        <div className="grid">
          <section className="span-12">
            {items.length === 0 ? (
              <p className="muted">{emptyMessage ?? "No accepted memory objects yet."}</p>
            ) : (
              <div className="item-list">
                {items.map((memory) => (
                  <MemoryRow key={textValue(memory._id, memory.id, memoryTitle(memory))} memory={memory} />
                ))}
              </div>
            )}
          </section>
          {counts.length ? (
            <section className="card section span-12">
              <h2>Types</h2>
              <div className="toolbar">
                {counts.map((count) => (
                  <span className="badge blue" key={textValue(count.objectType, count.type, count.label)}>
                    {textValue(count.objectType, count.type, count.label)}: {count.count ?? count.total ?? 0}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveMemoryDetailContent({ memoryId }: { memoryId: string }) {
  const viewerReady = useViewerReady();
  const data = useQuery(
    expectedMemoryApi.getMemoryDetailForViewer,
    viewerReady ? { memoryId: memoryId as any } : "skip",
  ) as AnyRecord | null | undefined;

  if (data === null) {
    return (
      <section className="card section">
        <h2>Memory not found</h2>
        <p className="muted">
          This memory may have been removed. <Link href="/memory">Back to Memory</Link>.
        </p>
      </section>
    );
  }

  const memory = data?.memory ?? data?.item ?? data;
  const sourceRefs = arrayValue(data?.sourceRefs ?? memory?.sourceRefs ?? memory?.sources);
  const relatedEntities = arrayValue(data?.relatedEntities ?? memory?.relatedEntities);
  const relationships = arrayValue(data?.relationships ?? memory?.relationships);
  const activityEvents = arrayValue(data?.activityEvents ?? memory?.activityEvents);

  return (
    <LiveGate>
      {!data || !memory ? (
        <section className="card section">
          <h2>Loading memory</h2>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-12">
            <div className="settings-row">
              <div>
                <h2>{memoryTitle(memory)}</h2>
                <p className="muted">{memorySummary(memory)}</p>
              </div>
              <span className="project-row-side">
                {memoryIsPendingReview(memory) ? <MemoryReviewActions memory={memory} /> : null}
                <span className={`badge ${badgeColorForState(memoryState(memory))}`}>{memoryState(memory)}</span>
              </span>
            </div>
            <div className="toolbar">
              <span className="badge blue">{memoryKind(memory)}</span>
              {memory.confidence ? <span className="badge">{Math.round(Number(memory.confidence) * 100)}% confidence</span> : null}
              {memory.updatedAt || memory.createdAt ? <span className="badge">Updated {formatDate(memory.updatedAt ?? memory.createdAt)}</span> : null}
            </div>
            {memoryReason(memory) ? <p className="muted">Capture: {memoryReason(memory)}</p> : null}
          </section>

          <section className="card section span-12">
            <h2>Sources</h2>
            <SourceRefList sourceRefs={sourceRefs} />
          </section>

          <section className="card section span-6">
            <h2>Related entities</h2>
            <RelatedEntityList entities={relatedEntities} />
          </section>

          <section className="card section span-6">
            <h2>Relationships</h2>
            <RelatedEntityList entities={relationships} />
          </section>

          {activityEvents.length ? (
            <section className="card section span-12">
              <h2>Activity</h2>
              <div className="item-list">
                {activityEvents.map((event) => (
                  <article className="item" key={textValue(event._id, event.id, event.summary)}>
                    <span className="item-icon">
                      <icons.Clock3 size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{textValue(event.summary, event.activityType) || "Activity"}</p>
                      <p className="item-meta">
                        {textValue(event.activityType, event.actorType) || "event"}
                        {event.timestamp ? ` · ${formatDate(event.timestamp)}` : ""}
                      </p>
                    </div>
                    <span className="badge">{textValue(event.actorType) || "system"}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveTriageContent() {
  const viewerReady = useViewerReady();
  const viewer = useQuery(api.auth.viewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const items = useQuery(api.knowledge.triageForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const entityOptions = useQuery(api.knowledge.acceptedEntityOptionsForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const displayLabels = displayLabelsFrom(viewer);

  return (
    <LiveGate>
      {!items || !entityOptions ? (
        <section className="card section">
          <h2>Loading review items</h2>
        </section>
      ) : (
        <div className="item-list">
          {items.length === 0 ? <p className="muted">No unclear signals need review.</p> : null}
          {items.map((item) => (
            <TriageItem key={item._id} item={item} entityOptions={entityOptions} displayLabels={displayLabels} />
          ))}
        </div>
      )}
    </LiveGate>
  );
}

function TriageItem({
  item,
  entityOptions,
  displayLabels,
}: {
  item: AnyRecord;
  entityOptions: AnyRecord[];
  displayLabels: { ownerName: string; agentName: string };
}) {
  const review = useMutation(api.knowledge.reviewTriageItem);
  const [targetEntityType, setTargetEntityType] = useState(item.candidateEntityType ?? "note");
  const [editedPayload, setEditedPayload] = useState(() =>
    editablePayloadFor(item.candidateEntityType ?? "note", item.candidatePayload ?? {}),
  );
  const [mergeTargetId, setMergeTargetId] = useState("");
  const mergeOptions = useMemo(
    () => matchOptions(item, editedPayload, targetEntityType, entityOptions),
    [editedPayload, entityOptions, item, targetEntityType],
  );
  const bestMergeOptions = mergeOptions.filter((option) => option.matchScore > 0).slice(0, 8);
  const remainingMergeOptions = mergeOptions.filter((option) => option.matchScore === 0).slice(0, 20);

  useEffect(() => {
    if (mergeTargetId && !mergeOptions.some((option) => option.entityId === mergeTargetId)) {
      setMergeTargetId("");
    }
  }, [mergeOptions, mergeTargetId]);

  async function submit(action: "approve" | "reject" | "correct" | "merge" | "reclassify") {
    if (action === "merge" && !mergeTargetId) {
      return;
    }
    const args: AnyRecord = { triageItemId: item._id, action };
    if (action === "correct" || action === "reclassify") {
      args.correctedPayload = compactPayload(editedPayload);
    }
    if (action === "reclassify") {
      args.targetEntityType = targetEntityType;
    }
    if (action === "merge") {
      args.mergeTarget = { entityType: targetEntityType, entityId: mergeTargetId };
    }
    await review(args as any);
  }

  return (
    <article className="item">
      <span className="item-icon">
        <icons.Archive size={17} aria-hidden />
      </span>
      <div className="form-grid">
        <div>
          <p className="item-title">{titleForReviewItem(item)}</p>
          <p className="item-meta">
            {item.candidateEntityType} signal
            {item.confidence ? `, confidence ${Math.round(item.confidence * 100)}%` : ""}
          </p>
        </div>
        <PayloadEditor
          entityType={targetEntityType}
          payload={editedPayload}
          setPayload={setEditedPayload}
          displayLabels={displayLabels}
        />
        <div className="split-list">
          <label className="field">
            <span>Target type</span>
            <select
              className="select"
              value={targetEntityType}
              onChange={(event) => {
                const nextType = event.target.value;
                setTargetEntityType(nextType);
                setEditedPayload(editablePayloadFor(nextType, editedPayload));
              }}
            >
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Merge target</span>
            <select className="select" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
              <option value="">Select existing {targetEntityType}</option>
              {bestMergeOptions.length ? <option disabled>Suggested matches</option> : null}
              {bestMergeOptions.map((option) => (
                <option key={option.entityId} value={option.entityId}>
                  {option.title} - {Math.round(option.matchScore * 100)}%
                </option>
              ))}
              {remainingMergeOptions.length ? <option disabled>Other accepted {targetEntityType}s</option> : null}
              {remainingMergeOptions.map((option) => (
                <option key={option.entityId} value={option.entityId}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="toolbar" aria-label={`Review actions for ${titleForReviewItem(item)}`}>
        <button
          className="icon-button"
          type="button"
          title="Approve as-is"
          aria-label={`Approve ${titleForReviewItem(item)} as-is`}
          onClick={() => void submit("approve")}
        >
          <icons.Check size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Approve with edited payload"
          aria-label={`Approve ${titleForReviewItem(item)} with edited payload`}
          onClick={() => void submit("correct")}
        >
          <icons.CircleCheck size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Reclassify to selected target type"
          aria-label={`Reclassify ${titleForReviewItem(item)} to selected target type`}
          onClick={() => void submit("reclassify")}
        >
          <icons.Shuffle size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Merge into target ID"
          aria-label={`Merge ${titleForReviewItem(item)} into target ID`}
          disabled={!mergeTargetId}
          onClick={() => void submit("merge")}
        >
          <icons.LinkIcon size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Reject signal"
          aria-label={`Reject ${titleForReviewItem(item)}`}
          onClick={() => void submit("reject")}
        >
          <icons.X size={17} aria-hidden />
        </button>
      </div>
    </article>
  );
}

function PayloadEditor({
  entityType,
  payload,
  setPayload,
  displayLabels,
}: {
  entityType: string;
  payload: AnyRecord;
  setPayload: (payload: AnyRecord) => void;
  displayLabels: { ownerName: string; agentName: string };
}) {
  function update(field: string, value: string) {
    setPayload({ ...payload, [field]: value });
  }

  const field = (name: string, label: string, options?: { multiline?: boolean; type?: string }) => (
    <label className="field" key={name}>
      <span>{label}</span>
      {options?.multiline ? (
        <textarea className="textarea" value={payload[name] ?? ""} onChange={(event) => update(name, event.target.value)} />
      ) : (
        <input
          className="input"
          type={options?.type ?? "text"}
          value={payload[name] ?? ""}
          onChange={(event) => update(name, event.target.value)}
        />
      )}
    </label>
  );

  const status = statusOptions[entityType] ? (
    <label className="field">
      <span>Status</span>
      <select className="select" value={payload.status ?? statusOptions[entityType][0]} onChange={(event) => update("status", event.target.value)}>
        {statusOptions[entityType].map((statusValue) => (
          <option key={statusValue} value={statusValue}>
            {statusValue}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  if (entityType === "task") {
    const ownerType = (
      <label className="field">
        <span>Owner</span>
        <select className="select" value={payload.ownerType ?? ""} onChange={(event) => update("ownerType", event.target.value)}>
          <option value="">Unspecified</option>
          <option value="owner">{displayLabels.ownerName}</option>
          <option value="agent">{displayLabels.agentName}</option>
        </select>
      </label>
    );

    return (
      <div className="form-grid compact-form">
        {field("title", "Title")}
        <div className="split-list">
          {status}
          {ownerType}
          {field("dueDate", "Due date")}
        </div>
        {field("description", "Description", { multiline: true })}
        {field("sourceSummary", "Source summary", { multiline: true })}
        {field("priorityReason", "Priority reason")}
      </div>
    );
  }

  if (entityType === "project") {
    return (
      <div className="form-grid compact-form">
        {field("title", "Title")}
        {status}
        {field("summary", "Summary", { multiline: true })}
        {field("priorityReason", "Priority reason")}
      </div>
    );
  }

  if (entityType === "person") {
    return (
      <div className="form-grid compact-form">
        <div className="split-list">
          {field("name", "Name")}
          {field("email", "Email", { type: "email" })}
        </div>
        {field("relationshipContext", "Relationship context", { multiline: true })}
        {field("notes", "Notes", { multiline: true })}
      </div>
    );
  }

  if (entityType === "company") {
    return (
      <div className="form-grid compact-form">
        <div className="split-list">
          {field("name", "Name")}
          {field("website", "Website", { type: "url" })}
        </div>
        <label className="field">
          <span>Relationship</span>
          <select
            className="select"
            value={payload.relationshipLabel ?? "other"}
            onChange={(event) => update("relationshipLabel", event.target.value)}
          >
            {["client", "vendor", "employer", "partner", "prospect", "other"].map((relationship) => (
              <option key={relationship} value={relationship}>
                {relationship}
              </option>
            ))}
          </select>
        </label>
        {field("notes", "Notes", { multiline: true })}
      </div>
    );
  }

  if (entityType === "link") {
    return (
      <div className="form-grid compact-form">
        {field("url", "URL", { type: "url" })}
        {field("title", "Title")}
        {status}
        {field("summary", "Summary", { multiline: true })}
        {field("whyItMatters", "Why it matters")}
      </div>
    );
  }

  if (entityType === "note") {
    return (
      <div className="form-grid compact-form">
        {field("title", "Title")}
        {field("body", "Body", { multiline: true })}
      </div>
    );
  }

  if (entityType === "goal") {
    return (
      <div className="form-grid compact-form">
        {field("title", "Title")}
        {status}
        {field("description", "Description", { multiline: true })}
      </div>
    );
  }

  return (
    <div className="form-grid compact-form">
      {field("objectType", "Object type")}
      {field("title", "Title")}
      {field("summary", "Summary", { multiline: true })}
    </div>
  );
}

export function LivePendingActionsContent() {
  const viewerReady = useViewerReady();
  const actions = useQuery(api.knowledge.pendingActionsForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const reviewPendingActionMutation = useMutation(api.knowledge.reviewPendingActionForViewer);
  const reviewPendingAction = async (args: AnyRecord) => reviewPendingActionMutation(args as any);

  return (
    <LiveGate>
      {!actions ? (
        <section className="card section">
          <h2>Loading pending actions</h2>
        </section>
      ) : (
        <div className="item-list">
          {actions.length === 0 ? <p className="muted">No pending external actions.</p> : null}
          {actions.map((action) => (
            <PendingActionItem key={action._id} action={action} reviewPendingAction={reviewPendingAction} />
          ))}
        </div>
      )}
    </LiveGate>
  );
}

function PendingActionItem({
  action,
  reviewPendingAction,
}: {
  action: AnyRecord;
  reviewPendingAction: (args: AnyRecord) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(() => editablePendingAction(action));
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reviewable = ["drafted", "pending_approval", "failed"].includes(action.status);
  const primaryText = textValue(action.body, action.messageBody, action.approvalNotes, action.status);

  function update(field: string, value: string) {
    setDraft({ ...draft, [field]: value });
  }

  async function submit(nextAction: "approve" | "reject" | "revise") {
    setBusyAction(nextAction);
    setError(null);
    try {
      const args: AnyRecord = {
        pendingActionId: action._id,
        action: nextAction,
        approvalNotes: textOrUndefined(draft.approvalNotes),
      };
      if (nextAction === "revise") {
        args.recipients = parseRecipients(draft.recipients);
        args.subject = draft.subject;
        args.body = draft.body;
        args.messageBody = draft.messageBody;
      }
      await reviewPendingAction(args);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update pending action.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <article className="item pending-action-item">
      <span className="item-icon">
        <icons.MessageSquareText size={17} aria-hidden />
      </span>
      <div className="form-grid">
        <div>
          <p className="item-title">{action.subject ?? action.actionType}</p>
          <p className="item-meta">{primaryText}</p>
        </div>
        {reviewable ? (
          <div className="form-grid compact-form">
            <div className="split-list">
              <label className="field">
                <span>Recipients</span>
                <input className="input" value={draft.recipients} onChange={(event) => update("recipients", event.target.value)} />
              </label>
              <label className="field">
                <span>Subject</span>
                <input className="input" value={draft.subject} onChange={(event) => update("subject", event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Message</span>
              <textarea className="textarea" value={draft.messageBody || draft.body} onChange={(event) => update("messageBody", event.target.value)} />
            </label>
            <label className="field">
              <span>Review notes</span>
              <input className="input" value={draft.approvalNotes} onChange={(event) => update("approvalNotes", event.target.value)} />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        ) : (
          <p className="muted">{statusDescription(action)}</p>
        )}
      </div>
      <div className="pending-action-side">
        <span className={`badge ${badgeForPendingAction(action.status)}`}>{action.status}</span>
        {reviewable ? (
          <div className="toolbar" aria-label={`Review actions for ${action.subject ?? action.actionType}`}>
            <button
              className="icon-button"
              type="button"
              title="Approve action"
              aria-label={`Approve ${action.subject ?? action.actionType}`}
              disabled={Boolean(busyAction)}
              onClick={() => void submit("approve")}
            >
              <icons.Check size={17} aria-hidden />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Save revisions"
              aria-label={`Save revisions for ${action.subject ?? action.actionType}`}
              disabled={Boolean(busyAction)}
              onClick={() => void submit("revise")}
            >
              <icons.CircleCheck size={17} aria-hidden />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Reject action"
              aria-label={`Reject ${action.subject ?? action.actionType}`}
              disabled={Boolean(busyAction)}
              onClick={() => void submit("reject")}
            >
              <icons.X size={17} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function editablePendingAction(action: AnyRecord) {
  return {
    recipients: formatRecipients(action.recipients),
    subject: textValue(action.subject),
    body: textValue(action.body),
    messageBody: textValue(action.messageBody, action.body),
    approvalNotes: textValue(action.approvalNotes),
  };
}

function formatRecipients(recipients: unknown) {
  if (Array.isArray(recipients)) {
    return recipients.join(", ");
  }
  if (typeof recipients === "string") {
    return recipients;
  }
  return recipients ? JSON.stringify(recipients) : "";
}

function parseRecipients(recipients: string) {
  const trimmed = recipients.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.split(",").map((recipient) => recipient.trim()).filter(Boolean);
    }
  }
  return trimmed.split(",").map((recipient) => recipient.trim()).filter(Boolean);
}

function badgeForPendingAction(status: string) {
  if (status === "approved" || status === "sent" || status === "completed") {
    return "blue";
  }
  if (status === "rejected" || status === "failed") {
    return "red";
  }
  return "gold";
}

function statusDescription(action: AnyRecord) {
  if (action.status === "approved") {
    return "Approved and waiting for execution.";
  }
  if (action.status === "sent" || action.status === "completed") {
    return `Recorded${action.executedAt ? ` ${formatDate(action.executedAt)}` : ""}.`;
  }
  if (action.status === "rejected") {
    return "Rejected during review.";
  }
  return action.error ?? "No further review available.";
}

const defaultNotificationPreferences = {
  urgentEnabled: true,
  pendingActionEnabled: true,
  focusSummaryEnabled: false,
  dailyDigestEnabled: false,
  minPriorityScore: 0.7,
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  },
};

const defaultImportanceRubric = [
  "Create or update Skippy knowledge when an item is actionable, deadline-bearing, financially/security relevant, relationship-building, tied to an active project/goal, or clearly useful for future recall.",
  "Ignore newsletters, one-time login codes, routine receipts, promotions, social notifications, and FYI updates unless they affect money, access, commitments, relationships, or current focus.",
  "Prefer direct accepted ingestion with source references when the harness can explain why the item clears this rubric.",
  "Record a concise rubricDecision for each direct ingestion so Skippy can learn what mattered.",
].join("\n");

const defaultMemoryPrivacyPolicy = {
  storageMode: "summaries_with_refs",
  excludedContent: "Do not store passwords, one-time codes, raw financial account numbers, medical details, or private content that is not needed for recall.",
  sensitiveContentInstructions:
    "Prefer short summaries and source references for sensitive items. Store only the minimum needed to remember the commitment, decision, or relationship context.",
};

const defaultRecallPreferences = {
  cadence: "active_context",
  focusWindow: "Recall active goals, in-progress projects, pending actions, and recent decisions before suggesting next steps.",
  allowProactiveRecall: true,
};

const defaultHarnessAutonomyPolicy = {
  ingestionMode: "auto_accept_high_confidence",
  actionApproval: "always_require",
  notes: "Harnesses may write high-confidence, source-backed memories. External actions should stay drafted until reviewed.",
};

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function RubricContextGroup({
  label,
  href,
  items,
  empty,
}: {
  label: string;
  href: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="rubric-group">
      <div className="settings-row">
        <h3>{label}</h3>
        <Link className="text-button compact" href={href}>
          Manage
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="toolbar">
          {items.map((item) => (
            <span className="badge blue" key={item}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function LiveSettingsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.settings.getSettings, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const effectiveRubric = useQuery(api.settings.getEffectiveRubricForViewer, viewerReady ? {} : "skip") as
    | AnyRecord
    | undefined;
  const updateConfig = useMutation(api.settings.updateConfig);
  const updateSecondBrainSettings = useMutation((api.settings as AnyRecord).updateSecondBrainSettingsForViewer);
  const upsertPushSubscription = useMutation(api.settings.upsertPushSubscription);
  const disablePushSubscription = useMutation(api.settings.disablePushSubscription);
  const upsertOperatingRule = useMutation(api.settings.upsertOperatingRule);
  const createToken = useMutation(api.mcpTokens.create);
  const revokeToken = useMutation(api.mcpTokens.revoke);
  const [label, setLabel] = useState("Local harness");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const config = data?.config;
  const memoryPrivacyPolicy = {
    ...defaultMemoryPrivacyPolicy,
    ...(config?.memoryPrivacyPolicy ?? {}),
  };
  const recallPreferences = {
    ...defaultRecallPreferences,
    ...(config?.recallPreferences ?? {}),
  };
  const harnessAutonomyPolicy = {
    ...defaultHarnessAutonomyPolicy,
    ...(config?.harnessAutonomyPolicy ?? {}),
  };

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading settings</h2>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-7">
            <h2>Importance policy</h2>
            <p className="muted">
              Your stable, hand-written rubric. Harnesses combine this with live context (goals, in-progress projects,
              favorited contacts) to decide what belongs in Skippy. Items that clear the bar are written directly into
              accepted knowledge with source references and a short decision note.
            </p>
            <label className="field">
              <span>Policy text</span>
              <textarea
                className="textarea"
                key={
                  data.operatingRules?.find(
                    (rule: AnyRecord) => rule.scope === "importance" && rule.ruleType === "default",
                  )?.updatedAt ?? "default"
                }
                defaultValue={
                  data.operatingRules?.find(
                    (rule: AnyRecord) => rule.scope === "importance" && rule.ruleType === "default",
                  )?.ruleText ?? defaultImportanceRubric
                }
                onBlur={(event) =>
                  void upsertOperatingRule({
                    scope: "importance",
                    ruleType: "default",
                    ruleText: event.target.value,
                    source: "explicit_user_setting",
                    enabled: true,
                    confidence: 1,
                  } as any)
                }
              />
            </label>
          </section>
          <section className="card section span-5">
            <h2>Effective rubric</h2>
            <p className="muted">What harnesses receive from get_importance_rubric — your policy plus live context.</p>
            {!effectiveRubric ? (
              <p className="muted">Composing…</p>
            ) : (
              <div className="form-grid">
                <RubricContextGroup
                  label="Active goals"
                  href="/goals"
                  items={effectiveRubric.goals.map((goal: AnyRecord) => goal.title)}
                  empty="No active goals."
                />
                <RubricContextGroup
                  label="In-progress projects"
                  href="/projects"
                  items={effectiveRubric.activeProjects.map((project: AnyRecord) => project.title)}
                  empty="No in-progress projects."
                />
                <RubricContextGroup
                  label="Favorited contacts"
                  href="/contacts"
                  items={effectiveRubric.favoriteContacts.map((contact: AnyRecord) => contact.name)}
                  empty="No favorited contacts."
                />
                <details className="rubric-rendered">
                  <summary>Preview composed text</summary>
                  <pre className="code rubric-rendered-text">{effectiveRubric.renderedText}</pre>
                </details>
              </div>
            )}
          </section>
          <section className="card section span-6">
            <h2>Privacy and storage</h2>
            <p className="muted">What Skippy should avoid storing, and how much source material harnesses may keep.</p>
            <div className="form-grid">
              <label className="field">
                <span>Storage mode</span>
                <select
                  className="select"
                  value={memoryPrivacyPolicy.storageMode}
                  onChange={(event) =>
                    void updateSecondBrainSettings({
                      memoryPrivacyPolicy: { ...memoryPrivacyPolicy, storageMode: event.target.value },
                    } as any)
                  }
                >
                  <option value="summaries_with_refs">Summaries with source refs</option>
                  <option value="source_refs_only">Source refs only for sensitive items</option>
                  <option value="full_content_when_important">Full content when important</option>
                </select>
              </label>
              <label className="field">
                <span>Do not store</span>
                <textarea
                  className="textarea"
                  key={`excluded-${memoryPrivacyPolicy.excludedContent}`}
                  defaultValue={memoryPrivacyPolicy.excludedContent}
                  onBlur={(event) =>
                    void updateSecondBrainSettings({
                      memoryPrivacyPolicy: { ...memoryPrivacyPolicy, excludedContent: event.target.value },
                    } as any)
                  }
                />
              </label>
              <label className="field">
                <span>Sensitive content handling</span>
                <textarea
                  className="textarea"
                  key={`sensitive-${memoryPrivacyPolicy.sensitiveContentInstructions}`}
                  defaultValue={memoryPrivacyPolicy.sensitiveContentInstructions}
                  onBlur={(event) =>
                    void updateSecondBrainSettings({
                      memoryPrivacyPolicy: { ...memoryPrivacyPolicy, sensitiveContentInstructions: event.target.value },
                    } as any)
                  }
                />
              </label>
            </div>
          </section>
          <section className="card section span-6">
            <h2>Recall cadence</h2>
            <p className="muted">When Skippy should bring stored context back into focus.</p>
            <div className="form-grid">
              <label className="field">
                <span>Recall rhythm</span>
                <select
                  className="select"
                  value={recallPreferences.cadence}
                  onChange={(event) =>
                    void updateSecondBrainSettings({
                      recallPreferences: { ...recallPreferences, cadence: event.target.value },
                    } as any)
                  }
                >
                  <option value="active_context">When active context changes</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="manual">Only when asked</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={recallPreferences.allowProactiveRecall}
                  onChange={(event) =>
                    void updateSecondBrainSettings({
                      recallPreferences: { ...recallPreferences, allowProactiveRecall: event.target.checked },
                    } as any)
                  }
                />
                <span>Allow proactive recall</span>
              </label>
              <label className="field">
                <span>Recall focus</span>
                <textarea
                  className="textarea"
                  key={`recall-${recallPreferences.focusWindow}`}
                  defaultValue={recallPreferences.focusWindow}
                  onBlur={(event) =>
                    void updateSecondBrainSettings({
                      recallPreferences: { ...recallPreferences, focusWindow: event.target.value },
                    } as any)
                  }
                />
              </label>
            </div>
          </section>
          <section className="card section span-6">
            <h2>Harness autonomy</h2>
            <p className="muted">How much local harnesses may do before asking you to review.</p>
            <div className="form-grid">
              <label className="field">
                <span>Memory ingestion</span>
                <select
                  className="select"
                  value={harnessAutonomyPolicy.ingestionMode}
                  onChange={(event) =>
                    void updateSecondBrainSettings({
                      harnessAutonomyPolicy: { ...harnessAutonomyPolicy, ingestionMode: event.target.value },
                    } as any)
                  }
                >
                  <option value="suggest_only">Suggest only</option>
                  <option value="auto_accept_high_confidence">Auto-accept high confidence memories</option>
                  <option value="auto_accept_with_action_review">Auto-accept memory, review actions</option>
                </select>
              </label>
              <label className="field">
                <span>External actions</span>
                <select
                  className="select"
                  value={harnessAutonomyPolicy.actionApproval}
                  onChange={(event) =>
                    void updateSecondBrainSettings({
                      harnessAutonomyPolicy: { ...harnessAutonomyPolicy, actionApproval: event.target.value },
                    } as any)
                  }
                >
                  <option value="always_require">Always require approval</option>
                  <option value="allow_low_risk_drafts">Allow low-risk drafts</option>
                  <option value="allow_low_risk_send">Allow low-risk sends</option>
                </select>
              </label>
              <label className="field">
                <span>Autonomy notes</span>
                <textarea
                  className="textarea"
                  key={`autonomy-${harnessAutonomyPolicy.notes}`}
                  defaultValue={harnessAutonomyPolicy.notes}
                  onBlur={(event) =>
                    void updateSecondBrainSettings({
                      harnessAutonomyPolicy: { ...harnessAutonomyPolicy, notes: event.target.value },
                    } as any)
                  }
                />
              </label>
            </div>
          </section>
          <section className="card section span-6">
            <h2>Brain settings</h2>
            <div className="form-grid">
              <label className="field">
                <span>Assistant name</span>
                <input
                  className="input"
                  defaultValue={data.config?.assistantDisplayName ?? "Skippy"}
                  onBlur={(event) => void updateConfig({ assistantDisplayName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>LLM provider</span>
                <select
                  className="select"
                  defaultValue={data.config?.llmProviderMode ?? "none"}
                  onChange={(event) => void updateConfig({ llmProviderMode: event.target.value as any })}
                >
                  {["none", "openai", "anthropic", "openrouter", "local"].map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Embedding provider</span>
                <input
                  className="input"
                  defaultValue={data.config?.embeddingProviderMode ?? "none"}
                  onBlur={(event) => void updateConfig({ embeddingProviderMode: event.target.value })}
                />
              </label>
            </div>
          </section>
          <section className="card section span-6">
            <h2>Notifications</h2>
            <NotificationSettings
              config={data.config}
              pushSubscriptions={data.pushSubscriptions ?? []}
              permissionState={permissionState}
              setPermissionState={setPermissionState}
              error={notificationError}
              setError={setNotificationError}
              updateConfig={async (args) => updateConfig(args as any)}
              upsertPushSubscription={async (args) => upsertPushSubscription(args as any)}
              disablePushSubscription={async (args) => disablePushSubscription(args as any)}
            />
          </section>
          <section className="card section span-6">
            <h2>MCP tokens</h2>
            <div className="form-grid">
              <label className="field">
                <span>New token label</span>
                <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              <button
                className="text-button"
                type="button"
                onClick={async () => {
                  const result = (await createToken({ label })) as { token: string };
                  setCreatedToken(result.token);
                }}
              >
                Create token
              </button>
              {createdToken ? (
                <p className="code">
                  {createdToken}
                  <br />
                  This full value is only returned once.
                </p>
              ) : null}
              <div className="item-list">
                {data.tokens.map((token: AnyRecord) => (
                  <article className="item" key={token._id}>
                    <div>
                      <p className="item-title">{token.label}</p>
                      <p className="item-meta">
                        {token.tokenPrefix}..., last used {formatDate(token.lastUsedAt)}
                      </p>
                    </div>
                    <span className={token.revokedAt ? "badge red" : "badge blue"}>
                      {token.revokedAt ? "Revoked" : "Active"}
                    </span>
                    <button className="icon-button" type="button" title="Revoke" onClick={() => void revokeToken({ tokenId: token._id })}>
                      <icons.X size={17} aria-hidden />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </LiveGate>
  );
}

function NotificationSettings({
  config,
  pushSubscriptions,
  permissionState,
  setPermissionState,
  error,
  setError,
  updateConfig,
  upsertPushSubscription,
  disablePushSubscription,
}: {
  config: AnyRecord | null | undefined;
  pushSubscriptions: AnyRecord[];
  permissionState: string;
  setPermissionState: (state: string) => void;
  error: string | null;
  setError: (error: string | null) => void;
  updateConfig: (args: AnyRecord) => Promise<unknown>;
  upsertPushSubscription: (args: AnyRecord) => Promise<unknown>;
  disablePushSubscription: (args: AnyRecord) => Promise<unknown>;
}) {
  const preferences = {
    ...defaultNotificationPreferences,
    ...(config?.notificationPreferences ?? {}),
    quietHours: {
      ...defaultNotificationPreferences.quietHours,
      ...(config?.notificationPreferences?.quietHours ?? {}),
    },
  };
  const activeSubscriptions = pushSubscriptions.filter((subscription) => subscription.enabled && !subscription.revokedAt);
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const browserCanPush = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

  async function updatePreferences(nextPreferences: AnyRecord) {
    await updateConfig({ notificationPreferences: nextPreferences });
  }

  async function setPreference(field: string, value: boolean | number | undefined) {
    await updatePreferences({ ...preferences, [field]: value });
  }

  async function enableBrowserNotifications() {
    setError(null);
    if (!browserCanPush) {
      setPermissionState("unsupported");
      setError("This browser does not support web push notifications.");
      return;
    }

    const permission = await Notification.requestPermission();
    setPermissionState(permission);
    if (permission !== "granted") {
      await updateConfig({ notificationsEnabled: false });
      return;
    }

    await updateConfig({ notificationsEnabled: true });
    if (!vapidPublicKey) {
      setError("Browser permission is enabled, but NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured yet.");
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      }));
    const serialized = subscription.toJSON();
    await upsertPushSubscription({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: serialized.keys?.p256dh ?? "",
        auth: serialized.keys?.auth ?? "",
      },
      expirationTime: subscription.expirationTime ?? undefined,
      userAgent: navigator.userAgent,
      permissionState: permission,
    });
  }

  return (
    <div className="form-grid">
      <div className="settings-row">
        <div>
          <h3>Browser push</h3>
          <p className="muted">
            Permission {permissionState}; {activeSubscriptions.length} active subscription
            {activeSubscriptions.length === 1 ? "" : "s"}.
          </p>
        </div>
        <span className={config?.notificationsEnabled ? "badge blue" : "badge"}>{config?.notificationsEnabled ? "On" : "Off"}</span>
      </div>
      <div className="toolbar">
        <button className="text-button" type="button" onClick={() => void enableBrowserNotifications()}>
          Enable browser push
        </button>
        <button className="text-button" type="button" onClick={() => void updateConfig({ notificationsEnabled: false })}>
          Pause notifications
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="split-list">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={preferences.urgentEnabled}
            onChange={(event) => void setPreference("urgentEnabled", event.target.checked)}
          />
          <span>Urgent items</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={preferences.pendingActionEnabled}
            onChange={(event) => void setPreference("pendingActionEnabled", event.target.checked)}
          />
          <span>Pending actions</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={preferences.focusSummaryEnabled}
            onChange={(event) => void setPreference("focusSummaryEnabled", event.target.checked)}
          />
          <span>Focus summaries</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={preferences.dailyDigestEnabled}
            onChange={(event) => void setPreference("dailyDigestEnabled", event.target.checked)}
          />
          <span>Daily digest</span>
        </label>
      </div>
      <div className="split-list">
        <label className="field">
          <span>Minimum priority</span>
          <input
            className="input"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={preferences.minPriorityScore ?? 0.7}
            onChange={(event) => void setPreference("minPriorityScore", Number(event.target.value))}
          />
        </label>
        <label className="checkbox-field checkbox-field-bottom">
          <input
            type="checkbox"
            checked={preferences.quietHours.enabled}
            onChange={(event) =>
              void updatePreferences({
                ...preferences,
                quietHours: { ...preferences.quietHours, enabled: event.target.checked },
              })
            }
          />
          <span>Quiet hours</span>
        </label>
      </div>
      <div className="split-list">
        <label className="field">
          <span>Quiet start</span>
          <input
            className="input"
            type="time"
            value={preferences.quietHours.start}
            onChange={(event) =>
              void updatePreferences({
                ...preferences,
                quietHours: { ...preferences.quietHours, start: event.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span>Quiet end</span>
          <input
            className="input"
            type="time"
            value={preferences.quietHours.end}
            onChange={(event) =>
              void updatePreferences({
                ...preferences,
                quietHours: { ...preferences.quietHours, end: event.target.value },
              })
            }
          />
        </label>
      </div>
      <div className="item-list">
        {pushSubscriptions.map((subscription) => (
          <article className="item" key={subscription._id}>
            <div>
              <p className="item-title">{subscription.userAgent?.split(" ").slice(0, 4).join(" ") ?? "Browser subscription"}</p>
              <p className="item-meta">
                Last seen {formatDate(subscription.lastSeenAt)}; permission {subscription.permissionState ?? "unknown"}
              </p>
            </div>
            <span className={subscription.enabled && !subscription.revokedAt ? "badge blue" : "badge red"}>
              {subscription.enabled && !subscription.revokedAt ? "Active" : "Disabled"}
            </span>
            <button
              className="icon-button"
              type="button"
              title="Disable subscription"
              disabled={!subscription.enabled || Boolean(subscription.revokedAt)}
              onClick={() => void disablePushSubscription({ pushSubscriptionId: subscription._id })}
            >
              <icons.X size={17} aria-hidden />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
