"use client";

import Link from "next/link";
import { useMemo, useState, type MouseEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { activeSourceSyncStatus } from "@skippy/shared";
import { api } from "../lib/skippy-api";
import { cn } from "@/lib/utils";
import { badgeBlueClass, badgeClass, badgeGoldClass, badgeGreenClass, badgeRedClass, cardClass, checkboxFieldBottomClass, checkboxFieldClass, codeClass, errorTextClass, eyebrowClass, fieldClass, fieldLabelClass, formGridClass, gridClass, iconButtonClass, iconButtonFavoriteClass, inputClass, itemClass, itemIconActiveClass, itemIconClass, itemListClass, itemMetaClass, itemTitleClass, mutedClass, projectRowClass, projectRowSideClass, sectionClass, selectClass, settingsRowClass, span12Class, span5Class, span6Class, span7Class, splitListClass, taskItemClass, taskSideClass, textButtonClass, textButtonCompactClass, textareaClass, toolbarClass } from "./page-classes";
import { agentRoleDisplayName, agentRoleFromMetadata } from "../lib/display";
import { focusItemKey, focusSummaryBullets, focusSummaryPresentation } from "./focus-summary";
import { contactDetailFields, contactMetaLabel } from "./contact-helpers";
import { LiveGate } from "./live-auth";
import { icons } from "./ui";
import { InlineMarkdown } from "./components";

type AnyRecord = Record<string, any>;
const statusOptions = { goal: ["active", "paused", "achieved", "abandoned"] };
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

function displayLabelsFrom(data: AnyRecord | undefined) {
  return {
    ownerName: textValue(data?.displayLabels?.ownerName, data?.user?.displayName, data?.user?.name) || "Owner",
    agentName:
      textValue(data?.displayLabels?.agentName, data?.config?.assistantDisplayName, data?.brain?.displayName) ||
      "Agent",
  };
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
    return run.status === "running" ? "still running" : "duration unavailable";
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading focus</h2>
          <p className={mutedClass}>Waiting for the latest Convex snapshot.</p>
        </section>
      ) : (
        <div className={gridClass}>
          <section
            className={cn(
              cardClass,
              sectionClass,
              span12Class,
              "grid min-h-[260px] content-between gap-[18px] border-l-4 border-l-blue",
            )}
          >
            <div>
              <div className="mb-1.5 flex items-center gap-2.5">
                <p className={cn(eyebrowClass, "mb-0")}>Now</p>
                {sourceSyncStatus ? (
                  <span
                    className="inline-flex min-h-[26px] items-center gap-1.5 rounded-lg border bg-blue/10 px-[9px] text-xs font-extrabold text-blue [&_svg]:animate-spin"
                    title={sourceSyncStatus.message ?? "Source sync is running"}
                  >
                    <icons.RefreshCw size={14} aria-hidden />
                    Updating
                  </span>
                ) : null}
              </div>
              {sourceSyncStatus ? (
                <p className="m-0 mb-3 max-w-[680px] text-sm text-muted-foreground">
                  {sourceSyncStatus.message ??
                    `Checking ${(sourceSyncStatus.sourceSystemsChecked ?? []).join(", ") || "connected sources"}.`}
                </p>
              ) : null}
              <h1 className="mb-[18px] max-w-[760px] text-[clamp(28px,4vw,44px)] leading-[1.08]">
                <InlineMarkdown>{displayedFocusHeading}</InlineMarkdown>
              </h1>
              {visibleFocusDetails.length ? (
                <ul className="grid max-w-[680px] gap-3 pl-[1.15em] text-xl leading-[1.42] text-foreground marker:text-green [&_li]:pl-0.5 [&_li>span:first-child]:mr-2.5">
                  {visibleFocusDetails.map((item) => (
                    <li key={item.itemKey}>
                      <span>
                        <InlineMarkdown>{item.text}</InlineMarkdown>
                      </span>
                      <span className="inline-flex gap-1.5 align-middle">
                        <button
                          className={cn(iconButtonClass, "size-[30px] min-h-[30px]")}
                          type="button"
                          title="Dismiss from focus"
                          aria-label={`Dismiss ${item.text}`}
                          disabled={busyFocusItemKey === item.itemKey}
                          onClick={() => void recordFocusAction(item, "dismissed")}
                        >
                          <icons.X size={16} aria-hidden />
                        </button>
                        <button
                          className={cn(textButtonClass, textButtonCompactClass, "h-[30px]")}
                          type="button"
                          title="Turn into task"
                          disabled={busyFocusItemKey === item.itemKey}
                          onClick={() => void promoteFocusItemToTask(item)}
                        >
                          Task
                        </button>
                        <button
                          className={cn(iconButtonClass, "size-[30px] min-h-[30px]")}
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
                <p className={cn(mutedClass, "mb-0 max-w-[680px] text-xl leading-[1.42] text-foreground")}>
                  All caught up. New items will show up here when they need attention.
                </p>
              )}
            </div>
          </section>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading projects</h2>
        </section>
      ) : data.projects.length === 0 ? (
        <p className={mutedClass}>No accepted projects yet.</p>
      ) : (
        <div className={itemListClass}>
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
    <Link className={cn(itemClass, projectRowClass)} href={href}>
      <span className={itemIconClass}>
        <icons.BriefcaseBusiness size={17} aria-hidden />
      </span>
      <div>
        <p className={itemTitleClass}>{project.title}</p>
        <p className={itemMetaClass}>
          {project.summary ?? "No summary yet."}
          {" · "}
          {taskCount} open task{taskCount === 1 ? "" : "s"}
        </p>
      </div>
      <span className={projectRowSideClass}>
        <span className={cn(badgeClass, badgeBlueClass)}>{project.status}</span>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading ingestion logs</h2>
        </section>
      ) : runs.length === 0 ? (
        <p className={mutedClass}>No ingestion runs have been recorded yet.</p>
      ) : (
        <div className={itemListClass}>
          {runs.map((run) => {
            const roleName = agentRoleDisplayName(agentRoleFromMetadata(run.metadata));
            return (
            <Link className={cn(itemClass, projectRowClass)} href={`/ingestion-logs/${run._id}`} key={run._id}>
              <span className={cn(itemIconClass, run.status === "running" && itemIconActiveClass)}>
                <icons.Archive size={17} aria-hidden />
              </span>
              <div>
                <p className={itemTitleClass}>{roleName ?? run.harness}</p>
                <p className={itemMetaClass}>
                  {roleName ? `on ${run.harness} · ` : ""}
                  {formatDate(run.startedAt)}
                  {" · "}
                  {(run.sourceSystemsChecked ?? []).join(", ") || "no sources recorded"}
                  {" · "}
                  {formatRunDuration(run)}
                </p>
              </div>
              <span className={projectRowSideClass}>
                <span className={cn(badgeClass, run.status === "failed" ? badgeRedClass : run.status === "running" ? badgeGoldClass : badgeBlueClass)}>
                  {run.status}
                </span>
                <icons.ChevronRight size={18} aria-hidden />
              </span>
            </Link>
            );
          })}
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
      <section className={cn(cardClass, sectionClass)}>
        <h2>Log not found</h2>
        <p className={mutedClass}>
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
  const runRoleName = run ? agentRoleDisplayName(agentRoleFromMetadata(run.metadata)) : null;

  return (
    <LiveGate>
      {!data ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading ingestion log</h2>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <div className={settingsRowClass}>
              <div>
                <h2>{runRoleName ?? run.harness}</h2>
                <p className={mutedClass}>
                  {runRoleName ? `on ${run.harness} · ` : ""}
                  Started {formatDate(run.startedAt)}
                  {run.completedAt
                    ? ` · ${run.status === "failed" ? "Failed" : "Completed"} ${formatDate(run.completedAt)}`
                    : run.status === "running"
                      ? " · Still running"
                      : ` · ${run.status === "failed" ? "Failed" : "Completed"} (finish time not recorded)`}
                  {run.status !== "running" || run.completedAt ? ` · ${formatRunDuration(run)}` : ""}
                </p>
              </div>
              <span className={cn(badgeClass, run.status === "failed" ? badgeRedClass : run.status === "running" ? badgeGoldClass : badgeBlueClass)}>
                {run.status}
              </span>
            </div>
            <div className={toolbarClass}>
              {(run.sourceSystemsChecked ?? []).map((source: string) => (
                <span className={badgeClass} key={source}>
                  {source}
                </span>
              ))}
            </div>
          </section>

          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Counts</h2>
            <div className={toolbarClass}>
              <span className={cn(badgeClass, badgeBlueClass)}>{run.objectsCreated ?? 0} created</span>
              <span className={cn(badgeClass, badgeBlueClass)}>{run.objectsUpdated ?? 0} updated</span>
              <span className={cn(badgeClass, badgeGoldClass)}>{run.candidatesSubmitted ?? 0} review candidates</span>
              <span className={cn(badgeClass, run.errors?.length ? badgeRedClass : badgeBlueClass)}>{run.errors?.length ?? 0} errors</span>
            </div>
            {run.errors?.length ? (
              <div className={itemListClass}>
                {run.errors.map((error: string) => (
                  <p className={mutedClass} key={error}>
                    {error}
                  </p>
                ))}
              </div>
            ) : null}
          </section>

          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Audit trail</h2>
            <div className={toolbarClass}>
              <span className={cn(badgeClass, badgeBlueClass)}>{auditSummary.capturedDirect ?? 0} captured</span>
              <span className={cn(badgeClass, badgeGoldClass)}>{auditSummary.sentToReview ?? 0} sent to review</span>
              <span className={cn(badgeClass, badgeBlueClass)}>{auditSummary.linked ?? 0} linked</span>
              <span className={cn(badgeClass, badgeBlueClass)}>{auditSummary.updated ?? 0} updated</span>
              <span className={cn(badgeClass, (auditSummary.rejected ?? 0) > 0 ? badgeRedClass : badgeBlueClass)}>{auditSummary.rejected ?? 0} rejected</span>
              <span className={badgeClass}>{auditSummary.ignored ?? 0} ignored</span>
            </div>
            {memories.length || entities.length ? (
              <div className={itemListClass}>
                {memories.map((memory: AnyRecord) => (
                  <Link className={cn(itemClass, projectRowClass)} href={memoryHref(memory)} key={memory._id}>
                    <span className={itemIconClass}>
                      <icons.Brain size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>{memoryTitle(memory)}</p>
                      <p className={itemMetaClass}>
                        {memoryKind(memory)}
                        {" · "}
                        {memoryState(memory)}
                      </p>
                      {memory.rubricDecision ? <p className={itemMetaClass}>Decision: {memory.rubricDecision}</p> : null}
                      {memory.captureReason ? <p className={itemMetaClass}>Capture: {memory.captureReason}</p> : null}
                    </div>
                    <span className={projectRowSideClass}>
                      <span className={cn(badgeClass, badgeColorForState(memoryState(memory)))}>{memoryState(memory)}</span>
                      <icons.ChevronRight size={18} aria-hidden />
                    </span>
                  </Link>
                ))}
                {entities.map((entry: AnyRecord) => {
                  const entity = entry.entity ?? entry;
                  return (
                    <article className={itemClass} key={`${entry.ref?.entityType ?? entity.entityType}:${entry.ref?.entityId ?? entity._id}`}>
                      <span className={itemIconClass}>
                        <icons.Archive size={17} aria-hidden />
                      </span>
                      <div>
                        <p className={itemTitleClass}>{relatedEntityTitle(entry)}</p>
                        <p className={itemMetaClass}>{relatedEntityMeta(entry)}</p>
                        {entity.priorityReason ? <p className={itemMetaClass}>{entity.priorityReason}</p> : null}
                      </div>
                      <span className={cn(badgeClass, badgeBlueClass)}>{entry.ref?.entityType ?? entity.entityType ?? "entity"}</span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={mutedClass}>No created or linked Skippy entities were detected for this run.</p>
            )}
            {ignoredItems.length ? (
              <details>
                <summary className={itemTitleClass}>Ignored or skipped items</summary>
                <pre className={cn(codeClass, "mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap")}>{formatJson(ignoredItems)}</pre>
              </details>
            ) : null}
          </section>

          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Activity</h2>
            {activityEvents.length === 0 ? (
              <p className={mutedClass}>No activity events were linked to this run or found in its time window.</p>
            ) : (
              <div className={itemListClass}>
                {activityEvents.map((event: AnyRecord) => (
                  <article className={itemClass} key={event._id}>
                    <span className={itemIconClass}>
                      <icons.Clock3 size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>{event.summary}</p>
                      <p className={itemMetaClass}>
                        {event.activityType}
                        {" · "}
                        {formatDate(event.timestamp)}
                      </p>
                      {event.metadata?.rubricDecision ? (
                        <p className={itemMetaClass}>Decision: {event.metadata.rubricDecision}</p>
                      ) : null}
                    </div>
                    <span className={badgeClass}>{event.actorType}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Source refs</h2>
            {sourceRefs.length === 0 ? (
              <p className={mutedClass}>No source references were linked to this run.</p>
            ) : (
              <div className={itemListClass}>
                {sourceRefs.map((sourceRef: AnyRecord) => (
                  <article className={itemClass} key={sourceRef._id}>
                    <span className={itemIconClass}>
                      <icons.LinkIcon size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>{sourceRef.summary ?? sourceRef.excerpt ?? sourceRef.externalId ?? sourceRef.sourceSystem}</p>
                      <p className={itemMetaClass}>
                        {sourceRef.sourceSystem}
                        {sourceRef.sourceTimestamp ? ` · ${formatDate(sourceRef.sourceTimestamp)}` : ""}
                      </p>
                      {sourceRef.participants?.length ? (
                        <p className={itemMetaClass}>Participants: {sourceRef.participants.join(", ")}</p>
                      ) : null}
                    </div>
                    <span className={badgeClass}>{sourceRef.messageId ?? sourceRef.eventId ?? sourceRef.threadId ?? "source"}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          {run.metadata ? (
            <section className={cn(cardClass, sectionClass, span12Class)}>
              <h2>Run metadata</h2>
              <pre className={cn(codeClass, "mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap")}>{formatJson(run.metadata)}</pre>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading project</h2>
        </section>
      ) : !project ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Project not found</h2>
          <p className={mutedClass}>
            This project may have been removed. <Link href="/projects">Back to projects</Link>.
          </p>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <div className={settingsRowClass}>
              <div>
                <h2>{project.title}</h2>
                <p className={mutedClass}>{project.summary ?? "No summary yet."}</p>
              </div>
              <span className={cn(badgeClass, badgeBlueClass)}>{project.status}</span>
            </div>
            {project.priorityReason ? <p className={mutedClass}>{project.priorityReason}</p> : null}
          </section>
          <section className={cn(cardClass, sectionClass, span12Class)}>
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
        <section className={cn(cardClass, sectionClass)}>
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
    return <p className={mutedClass}>No tasks here.</p>;
  }

  return (
    <div className={itemListClass}>
      {tasks.map((task) => {
        const isAgentTask = task.ownerType === "agent";
        const isInProgress = task.status === "in_progress";
        const isDone = task.status === "done";
        const actionLabel = isAgentTask ? `Start ${displayLabels.agentName} task` : "Mark done";
        const actionDisabled = isDone || (isAgentTask && isInProgress);
        const action = isAgentTask ? startAgentTask : markDone;
        const ActionIcon = isAgentTask ? icons.Play : icons.CircleCheck;

        return (
          <article className={cn(itemClass, taskItemClass)} key={task._id}>
            <span className={cn(itemIconClass, isInProgress && itemIconActiveClass)}>
              {isInProgress ? (
                <icons.Clock3 size={17} aria-hidden />
              ) : (
                <icons.Check size={17} aria-hidden />
              )}
            </span>
            <div>
              <p className={itemTitleClass}>{task.title}</p>
              <p className={itemMetaClass}>
                {isInProgress ? `In progress${task.startedBy ? ` by ${task.startedBy}` : ""}` : (task.priorityReason ?? task.status)}
              </p>
            </div>
            <span className={taskSideClass}>
              {task.ownerType ? <span className={badgeClass}>{taskOwnerLabel(task.ownerType, displayLabels)}</span> : null}
              <span className={cn(badgeClass, isInProgress ? badgeGoldClass : badgeBlueClass)}>{task.status}</span>
            </span>
            <button
              className={iconButtonClass}
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading goals</h2>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Add a goal</h2>
            <div className={toolbarClass}>
              <input
                className={inputClass}
                placeholder="New goal title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void addGoal();
                  }
                }}
              />
              <button className={textButtonClass} type="button" disabled={busy || !newTitle.trim()} onClick={() => void addGoal()}>
                Add goal
              </button>
            </div>
          </section>
          <section className={span12Class}>
            {data.goals.length === 0 ? (
              <p className={mutedClass}>No goals yet. Add one above; active goals feed the importance rubric.</p>
            ) : (
              <div className={itemListClass}>
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
  // Read card by default (Phase 2 pattern, mirrors TriageItem): the always-open
  // title/description/status form made the Goals list read as a wall of inputs.
  const [editing, setEditing] = useState(false);
  const save = (patch: AnyRecord) => void updateGoal({ goalId: goal._id, ...patch } as any);

  return (
    <article
      className={cn(itemClass, !editing && "cursor-pointer")}
      onClick={
        editing
          ? undefined
          : (event: MouseEvent<HTMLElement>) => {
              // Tap anywhere on the card to edit, but let the explicit Edit
              // button (and any future controls) handle their own clicks.
              if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label")) {
                return;
              }
              setEditing(true);
            }
      }
    >
      <span className={cn(itemIconClass, goal.status === "achieved" && itemIconActiveClass)}>
        <icons.Target size={17} aria-hidden />
      </span>
      {editing ? (
        <>
          <div className={formGridClass}>
            <input
              className={inputClass}
              defaultValue={goal.title}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== goal.title) {
                  save({ title: value });
                }
              }}
            />
            <textarea
              className={textareaClass}
              placeholder="Description"
              defaultValue={goal.description ?? ""}
              onBlur={(event) => {
                if (event.target.value !== (goal.description ?? "")) {
                  save({ description: event.target.value });
                }
              }}
            />
            <label className={fieldClass}>
              <span>Status</span>
              <select className={selectClass} defaultValue={goal.status} onChange={(event) => save({ status: event.target.value })}>
                {(statusOptions.goal ?? []).map((statusValue) => (
                  <option key={statusValue} value={statusValue}>
                    {statusValue}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CardActions
            label={`Goal actions for ${goal.title}`}
            actions={[
              { label: "Done", ariaLabel: `Done editing ${goal.title}`, primary: true, onClick: () => setEditing(false) },
            ]}
          />
        </>
      ) : (
        <>
          <div>
            <p className={itemTitleClass}>{goal.title}</p>
            {goal.description ? <p className={cn(itemMetaClass, "line-clamp-2")}>{goal.description}</p> : null}
          </div>
          <span className={taskSideClass}>
            <span className={cn(badgeClass, goal.status === "achieved" ? badgeGreenClass : badgeBlueClass)}>{goal.status}</span>
            <CardActions
              label={`Goal actions for ${goal.title}`}
              actions={[{ label: "Edit", ariaLabel: `Edit ${goal.title}`, onClick: () => setEditing(true) }]}
            />
          </span>
        </>
      )}
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading contacts</h2>
        </section>
      ) : (
        <div className={splitListClass}>
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
  return (
    <section>
      <h2>{title}</h2>
      <div className={itemListClass}>
        {items.length === 0 ? <p className={mutedClass}>No accepted records yet.</p> : null}
        {items.map((item) => (
          <ContactRow key={item._id} item={item} icon={icon} labelField={labelField} onToggleFavorite={onToggleFavorite} />
        ))}
      </div>
    </section>
  );
}

function ContactRow({
  item,
  icon,
  labelField,
  onToggleFavorite,
}: {
  item: AnyRecord;
  icon: "UserRound" | "LinkIcon";
  labelField: string;
  onToggleFavorite?: ((id: string, favorite: boolean) => void) | undefined;
}) {
  const Icon = icons[icon];
  const name = item[labelField];
  // Read card by default (Phase 2 pattern, mirrors GoalRow/TriageItem): long
  // bios previously rendered unclamped and squeezed into a one-word-per-line
  // column next to the side badges (docs/ui-audit). Tap the card (or More) to
  // expand the full record inline; no side panel needed at this scope.
  const [expanded, setExpanded] = useState(false);
  const details = contactDetailFields(item);
  return (
    <article
      className={cn(itemClass, "cursor-pointer")}
      onClick={(event: MouseEvent<HTMLElement>) => {
        // Tap anywhere on the card to toggle, but let the favorite star and
        // More/Less buttons handle their own clicks.
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label")) {
          return;
        }
        setExpanded((value) => !value);
      }}
    >
      <span className={itemIconClass}>
        <Icon size={17} aria-hidden />
      </span>
      {/* min-w-0 lets the 1fr grid track shrink below the text's intrinsic
          min-content width — without it long unbroken context forces the
          one-word-per-line squeeze the clamp alone can't fix. */}
      <div className="min-w-0">
        <p className={itemTitleClass}>{name}</p>
        {expanded ? (
          details.length === 0 ? (
            <p className={itemMetaClass}>Accepted</p>
          ) : (
            <div className="grid gap-1">
              {details.map((field) => (
                <p key={field.label} className={itemMetaClass}>
                  <span className="font-bold">{field.label}:</span> {field.value}
                </p>
              ))}
            </div>
          )
        ) : (
          <p className={cn(itemMetaClass, "line-clamp-2")}>{contactMetaLabel(item)}</p>
        )}
      </div>
      <span className={taskSideClass}>
        {onToggleFavorite ? (
          <button
            className={cn(iconButtonClass, item.favorite && iconButtonFavoriteClass)}
            type="button"
            title={item.favorite ? "Unfavorite contact" : "Favorite contact"}
            aria-pressed={Boolean(item.favorite)}
            aria-label={`${item.favorite ? "Unfavorite" : "Favorite"} ${name}`}
            onClick={() => onToggleFavorite(item._id, !item.favorite)}
          >
            <icons.Star size={17} fill={item.favorite ? "currentColor" : "none"} aria-hidden />
          </button>
        ) : null}
        <span className={badgeClass}>{item.relationshipLabel ?? item.roleTitle ?? "Contact"}</span>
        <CardActions
          label={`Contact actions for ${name}`}
          actions={[
            expanded
              ? { label: "Less", ariaLabel: `Collapse details for ${name}`, onClick: () => setExpanded(false) }
              : { label: "More", ariaLabel: `Show details for ${name}`, onClick: () => setExpanded(true) },
          ]}
        />
      </span>
    </article>
  );
}

const expectedMemoryApi = api.knowledge as AnyRecord;

// Expected backend queries:
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
    return badgeRedClass;
  }
  if (/suggest|pending|review|draft/i.test(state)) {
    return badgeGoldClass;
  }
  return badgeBlueClass;
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

function memoryKindLabel(memory: AnyRecord) {
  const kind = memoryKind(memory);
  if (kind === "memory") return "Fact";
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function MemoryRow({ memory }: { memory: AnyRecord }) {
  const reason = memoryReason(memory);
  const sourceRefs = arrayValue(memory.sourceRefs ?? memory.sources);
  const sourceRefIds = Array.isArray(memory.sourceRefIds) ? memory.sourceRefIds : [];
  const [expanded, setExpanded] = useState(false);

    return (
      <article className={itemClass}>
        <span className={itemIconClass}>
          <icons.BookOpen size={17} aria-hidden />
        </span>
        <div>
          <button
            className="block w-full text-left"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <p className={itemTitleClass}>{memoryTitle(memory)}</p>
            <p className={itemMetaClass}>
              {memory.updatedAt || memory.createdAt ? formatDate(memory.updatedAt ?? memory.createdAt) : "Date unknown"}
            </p>
          </button>
          {expanded ? (
            <div className="mt-3 grid gap-2 border-t pt-3">
              <p className={itemMetaClass}>{memorySummary(memory)}</p>
              {memory.confidence ? (
                <p className={itemMetaClass}>{Math.round(Number(memory.confidence) * 100)}% confidence</p>
              ) : null}
              {reason ? <p className={itemMetaClass}>Why it was saved: {reason}</p> : null}
              <InlineSourceRefs sourceRefs={sourceRefs} sourceRefIds={sourceRefIds} />
              <InlineRelatedEntities entities={arrayValue(memory.relatedEntities)} />
              <Link className={cn(textButtonClass, textButtonCompactClass, "w-fit")} href={memoryHref(memory)}>
                Open details
              </Link>
            </div>
          ) : null}
        </div>
        <span className={projectRowSideClass}>
          <span className={cn(badgeClass, badgeBlueClass)}>{memoryKindLabel(memory)}</span>
          <button
            className="grid size-8 place-items-center rounded-md hover:bg-muted"
            type="button"
            aria-label={expanded ? `Collapse ${memoryTitle(memory)}` : `Expand ${memoryTitle(memory)}`}
            onClick={() => setExpanded((value) => !value)}
          >
            <icons.ChevronRight className={cn("transition-transform", expanded && "rotate-90")} size={18} aria-hidden />
          </button>
        </span>
      </article>
    );
  }

function InlineSourceRefs({ sourceRefs, sourceRefIds }: { sourceRefs: AnyRecord[]; sourceRefIds?: unknown[] }) {
  if (sourceRefs.length === 0 && (!sourceRefIds || sourceRefIds.length === 0)) {
    return <p className={itemMetaClass}>No source references attached.</p>;
  }

  return (
    <div className={toolbarClass} aria-label="Source references">
      {sourceRefs.slice(0, 4).map((sourceRef) => (
        <span className={badgeClass} key={textValue(sourceRef._id, sourceRef.id, sourceRef.externalId, sourceRefTitle(sourceRef))}>
          {textValue(sourceRef.sourceSystem, sourceRef.provider) || "source"}
        </span>
      ))}
      {sourceRefs.length === 0
        ? sourceRefIds?.slice(0, 4).map((sourceRefId) => (
            <span className={badgeClass} key={String(sourceRefId)}>
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
    <div className={toolbarClass} aria-label="Related entities">
      {entities.slice(0, 5).map((entity) => (
        <span className={cn(badgeClass, badgeBlueClass)} key={textValue(entity.entityId, entity.id, entity._id, relatedEntityTitle(entity))}>
          {relatedEntityTitle(entity)}
        </span>
      ))}
    </div>
  );
}

function SourceRefList({ sourceRefs }: { sourceRefs: AnyRecord[] }) {
  if (sourceRefs.length === 0) {
    return <p className={mutedClass}>No source references were returned for this memory.</p>;
  }

  return (
    <div className={itemListClass}>
      {sourceRefs.map((sourceRef) => (
        <article className={itemClass} key={textValue(sourceRef._id, sourceRef.id, sourceRef.externalId, sourceRefTitle(sourceRef))}>
          <span className={itemIconClass}>
            <icons.LinkIcon size={17} aria-hidden />
          </span>
          <div>
            <p className={itemTitleClass}>{sourceRefTitle(sourceRef)}</p>
            <p className={itemMetaClass}>{sourceRefMeta(sourceRef)}</p>
            {sourceRef.participants?.length ? <p className={itemMetaClass}>Participants: {sourceRef.participants.join(", ")}</p> : null}
          </div>
          <span className={badgeClass}>{textValue(sourceRef.messageId, sourceRef.eventId, sourceRef.threadId, sourceRef.externalId) || "source"}</span>
        </article>
      ))}
    </div>
  );
}

function RelatedEntityList({ entities }: { entities: AnyRecord[] }) {
  if (entities.length === 0) {
    return <p className={mutedClass}>No related entities were returned yet.</p>;
  }

  return (
    <div className={itemListClass}>
      {entities.map((entity) => (
        <article className={itemClass} key={textValue(entity.entityId, entity.id, entity._id, relatedEntityTitle(entity))}>
          <span className={itemIconClass}>
            <icons.LinkIcon size={17} aria-hidden />
          </span>
          <div>
            <p className={itemTitleClass}>{relatedEntityTitle(entity)}</p>
            <p className={itemMetaClass}>{relatedEntityMeta(entity)}</p>
          </div>
          <span className={cn(badgeClass, badgeBlueClass)}>{textValue(entity.entityType, entity.type) || "entity"}</span>
        </article>
      ))}
    </div>
  );
}

export function LiveMemoryContent({ objectTypes, emptyMessage }: MemoryCollectionFilter = {}) {
  const viewerReady = useViewerReady();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "facts" | "decisions" | "principles">("all");
  const kinds = kind === "facts" ? ["memory"] : kind === "decisions" ? ["decision"] : kind === "principles" ? ["principle"] : objectTypes;
  const data = useQuery(
    expectedMemoryApi.searchMemoriesForViewer,
    viewerReady ? { query: query.trim() || undefined, kinds, limit: 50 } : "skip",
  ) as AnyRecord | AnyRecord[] | undefined;
  const results = collectionItems(data);
  const items = results.map((result) => result.memory ?? result);
  const filters = [
    ["all", "All"],
    ["facts", "Facts"],
    ["decisions", "Decisions"],
    ["principles", "Principles"],
  ] as const;

  return (
    <LiveGate>
      {!data ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading memory</h2>
          <p className={mutedClass}>Waiting for accepted memory objects from Convex.</p>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={span12Class}>
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Search memory</span>
              <input
                className={inputClass}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search everything Skippy knows…"
              />
            </label>
            <div className={cn(toolbarClass, "mt-3")} role="group" aria-label="Filter memory by kind">
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  className={cn(badgeClass, kind === key && badgeBlueClass)}
                  type="button"
                  aria-pressed={kind === key}
                  onClick={() => setKind(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className={span12Class}>
            {items.length === 0 ? (
              <p className={mutedClass}>{emptyMessage ?? "No accepted memory objects yet."}</p>
            ) : (
              <div className={itemListClass}>
                {items.map((memory) => (
                  <MemoryRow key={textValue(memory._id, memory.id, memoryTitle(memory))} memory={memory} />
                ))}
              </div>
            )}
          </section>
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
      <section className={cn(cardClass, sectionClass)}>
        <h2>Memory not found</h2>
        <p className={mutedClass}>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading memory</h2>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={cn(cardClass, sectionClass, span12Class)}>
            <div className={settingsRowClass}>
              <div>
                <h2>{memoryTitle(memory)}</h2>
                <p className={mutedClass}>{memorySummary(memory)}</p>
              </div>
              <span className={projectRowSideClass}>

                <span className={cn(badgeClass, badgeColorForState(memoryState(memory)))}>{memoryState(memory)}</span>
              </span>
            </div>
            <div className={toolbarClass}>
              <span className={cn(badgeClass, badgeBlueClass)}>{memoryKind(memory)}</span>
              {memory.confidence ? <span className={badgeClass}>{Math.round(Number(memory.confidence) * 100)}% confidence</span> : null}
              {memory.updatedAt || memory.createdAt ? <span className={badgeClass}>Updated {formatDate(memory.updatedAt ?? memory.createdAt)}</span> : null}
            </div>
            {memoryReason(memory) ? <p className={mutedClass}>Capture: {memoryReason(memory)}</p> : null}
          </section>

          <section className={cn(cardClass, sectionClass, span12Class)}>
            <h2>Sources</h2>
            <SourceRefList sourceRefs={sourceRefs} />
          </section>

          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>Related entities</h2>
            <RelatedEntityList entities={relatedEntities} />
          </section>

          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>Relationships</h2>
            <RelatedEntityList entities={relationships} />
          </section>

          {activityEvents.length ? (
            <section className={cn(cardClass, sectionClass, span12Class)}>
              <h2>Activity</h2>
              <div className={itemListClass}>
                {activityEvents.map((event) => (
                  <article className={itemClass} key={textValue(event._id, event.id, event.summary)}>
                    <span className={itemIconClass}>
                      <icons.Clock3 size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>{textValue(event.summary, event.activityType) || "Activity"}</p>
                      <p className={itemMetaClass}>
                        {textValue(event.activityType, event.actorType) || "event"}
                        {event.timestamp ? ` · ${formatDate(event.timestamp)}` : ""}
                      </p>
                    </div>
                    <span className={badgeClass}>{textValue(event.actorType) || "system"}</span>
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
    <div className="grid gap-2">
      <div className={settingsRowClass}>
        <h3>{label}</h3>
        <Link className={cn(textButtonClass, textButtonCompactClass)} href={href}>
          Manage
        </Link>
      </div>
      {items.length === 0 ? (
        <p className={mutedClass}>{empty}</p>
      ) : (
        <div className={toolbarClass}>
          {items.map((item) => (
            <span className={cn(badgeClass, badgeBlueClass)} key={item}>
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

  return (
    <LiveGate>
      {!data ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading settings</h2>
        </section>
      ) : (
        <div className={gridClass}>
          <section className={cn(cardClass, sectionClass, span7Class)}>
            <h2>Importance policy</h2>
            <p className={mutedClass}>
              Your stable, hand-written rubric. Harnesses combine this with live context (goals, in-progress projects,
              favorited contacts) to decide what belongs in Skippy. Items that clear the bar are written directly into
              accepted knowledge with source references and a short decision note.
            </p>
            <label className={fieldClass}>
              <span>Policy text</span>
              <textarea
                className={textareaClass}
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
          <section className={cn(cardClass, sectionClass, span5Class)}>
            <h2>Effective rubric</h2>
            <p className={mutedClass}>What harnesses receive from get_importance_rubric — your policy plus live context.</p>
            {!effectiveRubric ? (
              <p className={mutedClass}>Composing…</p>
            ) : (
              <div className={formGridClass}>
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
                <details>
                  <summary className="cursor-pointer text-[13px] font-bold">Preview composed text</summary>
                  <pre className={cn(codeClass, "mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap")}>
                    {effectiveRubric.renderedText}
                  </pre>
                </details>
              </div>
            )}
          </section>
          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>Privacy and storage</h2>
            <p className={mutedClass}>What Skippy should avoid storing, and how much source material harnesses may keep.</p>
            <div className={formGridClass}>
              <label className={fieldClass}>
                <span>Storage mode</span>
                <select
                  className={selectClass}
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
              <label className={fieldClass}>
                <span>Do not store</span>
                <textarea
                  className={textareaClass}
                  key={`excluded-${memoryPrivacyPolicy.excludedContent}`}
                  defaultValue={memoryPrivacyPolicy.excludedContent}
                  onBlur={(event) =>
                    void updateSecondBrainSettings({
                      memoryPrivacyPolicy: { ...memoryPrivacyPolicy, excludedContent: event.target.value },
                    } as any)
                  }
                />
              </label>
              <label className={fieldClass}>
                <span>Sensitive content handling</span>
                <textarea
                  className={textareaClass}
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
          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>Recall cadence</h2>
            <p className={mutedClass}>When Skippy should bring stored context back into focus.</p>
            <div className={formGridClass}>
              <label className={fieldClass}>
                <span>Recall rhythm</span>
                <select
                  className={selectClass}
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
              <label className={checkboxFieldClass}>
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
              <label className={fieldClass}>
                <span>Recall focus</span>
                <textarea
                  className={textareaClass}
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
          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>Brain settings</h2>
            <div className={formGridClass}>
              <label className={fieldClass}>
                <span>Assistant name</span>
                <input
                  className={inputClass}
                  defaultValue={data.config?.assistantDisplayName ?? "Skippy"}
                  onBlur={(event) => void updateConfig({ assistantDisplayName: event.target.value })}
                />
              </label>
              <label className={fieldClass}>
                <span>LLM provider</span>
                <select
                  className={selectClass}
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
              <label className={fieldClass}>
                <span>Embedding provider</span>
                <input
                  className={inputClass}
                  defaultValue={data.config?.embeddingProviderMode ?? "none"}
                  onBlur={(event) => void updateConfig({ embeddingProviderMode: event.target.value })}
                />
              </label>
            </div>
          </section>
          <section className={cn(cardClass, sectionClass, span6Class)}>
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
          <section className={cn(cardClass, sectionClass, span6Class)}>
            <h2>MCP tokens</h2>
            <div className={formGridClass}>
              <label className={fieldClass}>
                <span>New token label</span>
                <input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              <button
                className={textButtonClass}
                type="button"
                onClick={async () => {
                  const result = (await createToken({ label })) as { token: string };
                  setCreatedToken(result.token);
                }}
              >
                Create token
              </button>
              {createdToken ? (
                <p className={codeClass}>
                  {createdToken}
                  <br />
                  This full value is only returned once.
                </p>
              ) : null}
              <div className={itemListClass}>
                {data.tokens.map((token: AnyRecord) => (
                  <article className={itemClass} key={token._id}>
                    <div>
                      <p className={itemTitleClass}>{token.label}</p>
                      <p className={itemMetaClass}>
                        {token.tokenPrefix}..., last used {formatDate(token.lastUsedAt)}
                      </p>
                    </div>
                    {token.role ? (
                      <span className={cn(badgeClass, badgeGoldClass)} title={`Role-scoped token: ${token.role}`}>
                        {agentRoleDisplayName(token.role)}
                      </span>
                    ) : null}
                    <span className={cn(badgeClass, token.revokedAt ? badgeRedClass : badgeBlueClass)}>
                      {token.revokedAt ? "Revoked" : "Active"}
                    </span>
                    <button className={iconButtonClass} type="button" title="Revoke" onClick={() => void revokeToken({ tokenId: token._id })}>
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
    <div className={formGridClass}>
      <div className={settingsRowClass}>
        <div>
          <h3>Browser push</h3>
          <p className={mutedClass}>
            Permission {permissionState}; {activeSubscriptions.length} active subscription
            {activeSubscriptions.length === 1 ? "" : "s"}.
          </p>
        </div>
        <span className={cn(badgeClass, config?.notificationsEnabled && badgeBlueClass)}>{config?.notificationsEnabled ? "On" : "Off"}</span>
      </div>
      <div className={toolbarClass}>
        <button className={textButtonClass} type="button" onClick={() => void enableBrowserNotifications()}>
          Enable browser push
        </button>
        <button className={textButtonClass} type="button" onClick={() => void updateConfig({ notificationsEnabled: false })}>
          Pause notifications
        </button>
      </div>
      {error ? <p className={errorTextClass}>{error}</p> : null}
      <div className={splitListClass}>
        <label className={checkboxFieldClass}>
          <input
            type="checkbox"
            checked={preferences.urgentEnabled}
            onChange={(event) => void setPreference("urgentEnabled", event.target.checked)}
          />
          <span>Urgent items</span>
        </label>
        <label className={checkboxFieldClass}>
          <input
            type="checkbox"
            checked={preferences.focusSummaryEnabled}
            onChange={(event) => void setPreference("focusSummaryEnabled", event.target.checked)}
          />
          <span>Focus summaries</span>
        </label>
        <label className={checkboxFieldClass}>
          <input
            type="checkbox"
            checked={preferences.dailyDigestEnabled}
            onChange={(event) => void setPreference("dailyDigestEnabled", event.target.checked)}
          />
          <span>Daily digest</span>
        </label>
      </div>
      <div className={splitListClass}>
        <label className={fieldClass}>
          <span>Minimum priority</span>
          <input
            className={inputClass}
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={preferences.minPriorityScore ?? 0.7}
            onChange={(event) => void setPreference("minPriorityScore", Number(event.target.value))}
          />
        </label>
        <label className={cn(checkboxFieldClass, checkboxFieldBottomClass)}>
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
      <div className={splitListClass}>
        <label className={fieldClass}>
          <span>Quiet start</span>
          <input
            className={inputClass}
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
        <label className={fieldClass}>
          <span>Quiet end</span>
          <input
            className={inputClass}
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
      <div className={itemListClass}>
        {pushSubscriptions.map((subscription) => (
          <article className={itemClass} key={subscription._id}>
            <div>
              <p className={itemTitleClass}>{subscription.userAgent?.split(" ").slice(0, 4).join(" ") ?? "Browser subscription"}</p>
              <p className={itemMetaClass}>
                Last seen {formatDate(subscription.lastSeenAt)}; permission {subscription.permissionState ?? "unknown"}
              </p>
            </div>
            <span className={cn(badgeClass, subscription.enabled && !subscription.revokedAt ? badgeBlueClass : badgeRedClass)}>
              {subscription.enabled && !subscription.revokedAt ? "Active" : "Disabled"}
            </span>
            <button
              className={iconButtonClass}
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



function CardActions({
  label,
  actions,
}: {
  label: string;
  actions: { label: string; ariaLabel?: string; onClick: () => void; disabled?: boolean; primary?: boolean }[];
}) {
  return (
    <div className={toolbarClass} aria-label={label}>
      {actions.map((action) => (
        <button
          key={action.label}
          className={cn(textButtonClass, textButtonCompactClass, action.primary && "border-primary")}
          type="button"
          aria-label={action.ariaLabel}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
