"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { activeSourceSyncStatus } from "@skippy/shared";
import { api } from "../lib/skippy-api";
import { cn } from "@/lib/utils";
import {
  badgeBlueClass,
  badgeClass,
  badgeGoldClass,
  badgeGreenClass,
  badgeRedClass,
  cardClass,
  checkboxFieldBottomClass,
  checkboxFieldClass,
  codeClass,
  errorTextClass,
  eyebrowClass,
  fieldClass,
  fieldLabelClass,
  formGridClass,
  gridClass,
  iconButtonClass,
  iconButtonFavoriteClass,
  inputClass,
  itemClass,
  itemIconActiveClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
  pendingActionItemClass,
  pendingActionSideClass,
  projectRowClass,
  projectRowSideClass,
  reviewWarningClass,
  sectionClass,
  selectClass,
  settingsRowClass,
  span12Class,
  span4Class,
  span5Class,
  span6Class,
  span7Class,
  span8Class,
  splitListClass,
  taskItemClass,
  taskSideClass,
  textButtonClass,
  textButtonCompactClass,
  textareaClass,
  toolbarClass,
} from "./page-classes";
import { agentRoleDisplayName, agentRoleFromMetadata } from "../lib/display";
import { focusItemKey, focusSummaryBullets, focusSummaryPresentation } from "./focus-summary";
import { contactDetailFields, contactMetaLabel } from "./contact-helpers";
import { formatEventWhen, parseCalendarActionBody } from "./pending-action-helpers";
import { triageMetaLabel } from "./triage-helpers";
import { LiveGate } from "./live-auth";
import { SuggestionGroup } from "./resurfacing/live-client";
import { icons } from "./ui";
import { IconButton, InlineMarkdown, Tabs, useToast } from "./components";

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
              hasDecisionQueueItems ? span8Class : span12Class,
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
          {hasDecisionQueueItems ? (
            <section className={cn(span4Class, sectionClass)}>
              <h2>Needs your review</h2>
              <div className={itemListClass}>
                {unclearSignalCount > 0 ? (
                  <Link href="/review?filter=finds" className={cn(itemClass, projectRowClass)}>
                    <span className={itemIconClass}>
                      <icons.Archive size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>
                        {unclearSignalCount} {unclearSignalCount === 1 ? "find" : "finds"} waiting for a yes or no
                      </p>
                      <p className={itemMetaClass}>Things Skippy pulled from your sources but wasn&apos;t sure about.</p>
                    </div>
                    <span className={cn(badgeClass, badgeGoldClass)}>Review</span>
                  </Link>
                ) : null}
                {pendingActionCount > 0 ? (
                  <Link href="/review?filter=approvals" className={cn(itemClass, projectRowClass)}>
                    <span className={itemIconClass}>
                      <icons.MessageSquareText size={17} aria-hidden />
                    </span>
                    <div>
                      <p className={itemTitleClass}>
                        {pendingActionCount} {pendingActionCount === 1 ? "thing" : "things"} Skippy wants to do
                      </p>
                      <p className={itemMetaClass}>Nothing happens until you approve it.</p>
                    </div>
                    <span className={cn(badgeClass, badgeGoldClass)}>Approve</span>
                  </Link>
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
                  {run.completedAt ? ` · Completed ${formatDate(run.completedAt)}` : " · Still running"}
                  {" · "}
                  {formatRunDuration(run)}
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
    <Link className={cn(itemClass, projectRowClass)} href={memoryHref(memory)}>
      <span className={cn(itemIconClass, variant === "inbox" && itemIconActiveClass)}>
        {variant === "inbox" ? <icons.Brain size={17} aria-hidden /> : <icons.BookOpen size={17} aria-hidden />}
      </span>
      <div className={formGridClass}>
        <div>
          <p className={itemTitleClass}>{memoryTitle(memory)}</p>
          <p className={itemMetaClass}>
            {memoryKind(memory)}
            {memory.confidence ? ` · ${Math.round(Number(memory.confidence) * 100)}% confidence` : ""}
            {memory.updatedAt || memory.createdAt ? ` · ${formatDate(memory.updatedAt ?? memory.createdAt)}` : ""}
          </p>
        </div>
        <p className={itemMetaClass}>{memorySummary(memory)}</p>
        {reason ? <p className={itemMetaClass}>Capture: {reason}</p> : null}
        <InlineSourceRefs sourceRefs={sourceRefs} sourceRefIds={sourceRefIds} />
        <InlineRelatedEntities entities={arrayValue(memory.relatedEntities)} />
      </div>
      <span className={projectRowSideClass}>
        {variant === "inbox" && memoryIsPendingReview(memory) ? <MemoryReviewActions memory={memory} small /> : null}
        <span className={cn(badgeClass, badgeColorForState(state))}>{state}</span>
        <icons.ChevronRight size={18} aria-hidden />
      </span>
    </Link>
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
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading memory</h2>
          <p className={mutedClass}>Waiting for accepted memory objects from Convex.</p>
        </section>
      ) : (
        <div className={gridClass}>
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
          {counts.length ? (
            <section className={cn(cardClass, sectionClass, span12Class)}>
              <h2>Types</h2>
              <div className={toolbarClass}>
                {counts.map((count) => (
                  <span className={cn(badgeClass, badgeBlueClass)} key={textValue(count.objectType, count.type, count.label)}>
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
                {memoryIsPendingReview(memory) ? <MemoryReviewActions memory={memory} /> : null}
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

export type ReviewQueueFilter = "all" | "approvals" | "finds" | "revisit";

export function isReviewQueueFilter(value: unknown): value is ReviewQueueFilter {
  return value === "all" || value === "approvals" || value === "finds" || value === "revisit";
}

function ReviewSectionHeader({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <div className="mb-2.5">
      <p className={eyebrowClass}>
        {label} · {count}
      </p>
      <p className={mutedClass}>{hint}</p>
    </div>
  );
}

/**
 * The one Review queue (owner decision Sep 4, ui-ux-improvement-plan.md):
 * Approvals pinned first, then Finds — triage signals plus the old Brain Inbox
 * memory candidates, merged so there is one review surface — then Revisit at
 * the bottom. Filter chips replace the Signals/Actions/Routines tabs; order,
 * not tabs, carries the priority. Empty sections vanish instead of rendering
 * headers, and settled approvals live behind /review/history because a queue
 * is not a log.
 */
export function LiveReviewQueueContent({ initialFilter = "all" }: { initialFilter?: ReviewQueueFilter }) {
  const viewerReady = useViewerReady();
  const toast = useToast();
  const viewer = useQuery(api.auth.viewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const triageItems = useQuery(api.knowledge.triageForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const entityOptions = useQuery(api.knowledge.acceptedEntityOptionsForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const actions = useQuery(api.knowledge.pendingActionsForViewer, viewerReady ? { scope: "open" } : "skip") as
    | AnyRecord[]
    | undefined;
  const memoryData = useQuery(expectedMemoryApi.listMemoryInboxForViewer, viewerReady ? { limit: 50 } : "skip") as
    | AnyRecord
    | AnyRecord[]
    | undefined;
  const revisitData = useQuery(
    (api as AnyRecord).resurfacing.reviewSuggestionsForViewer,
    viewerReady ? { limit: 35 } : "skip",
  ) as AnyRecord | undefined;
  const reviewPendingActionMutation = useMutation(api.knowledge.reviewPendingActionForViewer);
  const reviewPendingAction = async (args: AnyRecord) => reviewPendingActionMutation(args as any);
  const expireStaleCandidates = useMutation(expectedMemoryApi.expireStaleMemoryCandidatesForViewer);

  const [filter, setFilter] = useState<ReviewQueueFilter>(initialFilter);
  const displayLabels = displayLabelsFrom(viewer);
  const memoryCandidates = collectionItems(memoryData);

  // Auto-archive stale memory candidates — carried over from the old Brain
  // Inbox when it merged into Finds so the housekeeping didn't get lost.
  const hasStaleCandidates = memoryCandidates.some(
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
        // Auto-expiry is best-effort; the queue stays usable if it fails.
      }
    })();
  }, [viewerReady, hasStaleCandidates, expireStaleCandidates, toast]);

  const loading = !triageItems || !entityOptions || !actions || memoryData === undefined || revisitData === undefined;
  if (loading) {
    return (
      <LiveGate>
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading your review queue</h2>
          <p className={mutedClass}>Gathering approvals, finds, and revisit suggestions.</p>
        </section>
      </LiveGate>
    );
  }

  const approvalsCount = actions.length;
  const findsCount = triageItems.length + memoryCandidates.length;
  const revisitGroups = arrayValue(revisitData?.groups).filter((group) => arrayValue(group.suggestions).length > 0);
  const revisitCount = arrayValue(revisitData?.suggestions).length;
  const total = approvalsCount + findsCount + revisitCount;

  const chips = [
    { key: "all", label: "All", count: total },
    { key: "approvals", label: "Approvals", count: approvalsCount },
    { key: "finds", label: "Finds", count: findsCount },
    { key: "revisit", label: "Revisit", count: revisitCount },
  ];

  // A section renders when it matches the filter and has items; on "All" the
  // empty ones disappear entirely — no headers over nothing.
  const showApprovals = filter === "approvals" || (filter === "all" && approvalsCount > 0);
  const showFinds = filter === "finds" || (filter === "all" && findsCount > 0);
  const showRevisit = filter === "revisit" || (filter === "all" && revisitCount > 0);

  return (
    <LiveGate>
      <div className="mb-[18px]">
        <Tabs items={chips} active={filter} onChange={(key) => setFilter(isReviewQueueFilter(key) ? key : "all")} />
      </div>
      {filter === "all" && total === 0 ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Review zero</h2>
          <p className={mutedClass}>Nothing needs a decision right now.</p>
        </section>
      ) : (
        <div className="grid gap-7">
          {showApprovals ? (
            <section aria-label="Approvals">
              <ReviewSectionHeader
                label="Approvals"
                count={approvalsCount}
                hint="Things Skippy wants to do in the real world — highest stakes, always first."
              />
              {approvalsCount === 0 ? (
                <p className={mutedClass}>Nothing waiting for approval.</p>
              ) : (
                <div className={itemListClass}>
                  {actions.map((action) => (
                    <PendingActionItem key={action._id} action={action} reviewPendingAction={reviewPendingAction} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {showFinds ? (
            <section aria-label="Finds">
              <ReviewSectionHeader
                label="Finds"
                count={findsCount}
                hint="Things Skippy found but wasn't sure about — candidate memories live here too."
              />
              {findsCount === 0 ? (
                <p className={mutedClass}>No finds waiting for a yes or no.</p>
              ) : (
                <div className={itemListClass}>
                  {triageItems.map((item) => (
                    <TriageItem key={item._id} item={item} entityOptions={entityOptions} displayLabels={displayLabels} />
                  ))}
                  {memoryCandidates.map((memory) => (
                    <MemoryRow key={textValue(memory._id, memory.id, memoryTitle(memory))} memory={memory} variant="inbox" />
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {showRevisit ? (
            <section aria-label="Revisit">
              <ReviewSectionHeader
                label="Revisit"
                count={revisitCount}
                hint="Old assumptions, open questions, and past decisions worth a second look. Suggestions only — nothing changes without you."
              />
              {revisitCount === 0 ? (
                <p className={mutedClass}>Nothing here looks stale or forgotten right now.</p>
              ) : (
                <div className={itemListClass}>
                  {revisitGroups.map((group) => (
                    <SuggestionGroup key={textValue(group.type, group.label)} group={group} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
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
  // Collapsed by default: the Phase 2 card pattern (ui-ux-improvement-plan.md)
  // makes editing opt-in — the always-open form was the worst offender on Review.
  const [expanded, setExpanded] = useState(false);
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

  const title = titleForReviewItem(item);

  return (
    <article className={itemClass}>
      <span className={itemIconClass}>
        <icons.Archive size={17} aria-hidden />
      </span>
      {expanded ? (
        <div className={formGridClass}>
          <div>
            <p className={itemTitleClass}>{title}</p>
            <p className={itemMetaClass}>{triageMetaLabel(item)}</p>
          </div>
          <PayloadEditor
            entityType={targetEntityType}
            payload={editedPayload}
            setPayload={setEditedPayload}
            displayLabels={displayLabels}
          />
          <div className={splitListClass}>
            <label className={fieldClass}>
              <span>Target type</span>
              <select
                className={selectClass}
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
            <label className={fieldClass}>
              <span>Merge target</span>
              <select className={selectClass} value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
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
      ) : (
        <div>
          <p className={itemTitleClass}>{title}</p>
          <p className={itemMetaClass}>{triageMetaLabel(item)}</p>
        </div>
      )}
      {expanded ? (
        <CardActions
          label={`Review actions for ${title}`}
          actions={[
            { label: "Accept as edited", ariaLabel: `Accept ${title} with edited payload`, primary: true, onClick: () => void submit("correct") },
            { label: "Reclassify", ariaLabel: `Reclassify ${title} to selected target type`, onClick: () => void submit("reclassify") },
            { label: "Merge", ariaLabel: `Merge ${title} into selected target`, disabled: !mergeTargetId, onClick: () => void submit("merge") },
            { label: "Dismiss", ariaLabel: `Dismiss ${title}`, onClick: () => void submit("reject") },
            { label: "Cancel", ariaLabel: `Collapse ${title} without submitting`, onClick: () => setExpanded(false) },
          ]}
        />
      ) : (
        <CardActions
          label={`Review actions for ${title}`}
          actions={[
            { label: "Accept", ariaLabel: `Accept ${title} as-is`, primary: true, onClick: () => void submit("approve") },
            { label: "Edit…", ariaLabel: `Edit ${title} before accepting`, onClick: () => setExpanded(true) },
            { label: "Dismiss", ariaLabel: `Dismiss ${title}`, onClick: () => void submit("reject") },
          ]}
        />
      )}
    </article>
  );
}

/**
 * Labeled text-button strip for the Phase 2 read cards. Replaces icon-only
 * toolbars — every action reads as a word, matching the Phase-1
 * PendingActionItem buttons. Reused by the Finds/Goals/Contacts card work.
 */
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
    <label className={fieldClass} key={name}>
      <span>{label}</span>
      {options?.multiline ? (
        <textarea className={textareaClass} value={payload[name] ?? ""} onChange={(event) => update(name, event.target.value)} />
      ) : (
        <input
          className={inputClass}
          type={options?.type ?? "text"}
          value={payload[name] ?? ""}
          onChange={(event) => update(name, event.target.value)}
        />
      )}
    </label>
  );

  const status = statusOptions[entityType] ? (
    <label className={fieldClass}>
      <span>Status</span>
      <select className={selectClass} value={payload.status ?? statusOptions[entityType][0]} onChange={(event) => update("status", event.target.value)}>
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
      <label className={fieldClass}>
        <span>Owner</span>
        <select className={selectClass} value={payload.ownerType ?? ""} onChange={(event) => update("ownerType", event.target.value)}>
          <option value="">Unspecified</option>
          <option value="owner">{displayLabels.ownerName}</option>
          <option value="agent">{displayLabels.agentName}</option>
        </select>
      </label>
    );

    return (
      <div className={formGridClass}>
        {field("title", "Title")}
        <div className={splitListClass}>
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
      <div className={formGridClass}>
        {field("title", "Title")}
        {status}
        {field("summary", "Summary", { multiline: true })}
        {field("priorityReason", "Priority reason")}
      </div>
    );
  }

  if (entityType === "person") {
    return (
      <div className={formGridClass}>
        <div className={splitListClass}>
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
      <div className={formGridClass}>
        <div className={splitListClass}>
          {field("name", "Name")}
          {field("website", "Website", { type: "url" })}
        </div>
        <label className={fieldClass}>
          <span>Relationship</span>
          <select
            className={selectClass}
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
      <div className={formGridClass}>
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
      <div className={formGridClass}>
        {field("title", "Title")}
        {field("body", "Body", { multiline: true })}
      </div>
    );
  }

  if (entityType === "goal") {
    return (
      <div className={formGridClass}>
        {field("title", "Title")}
        {status}
        {field("description", "Description", { multiline: true })}
      </div>
    );
  }

  return (
    <div className={formGridClass}>
      {field("objectType", "Object type")}
      {field("title", "Title")}
      {field("summary", "Summary", { multiline: true })}
    </div>
  );
}

/**
 * Settled approvals (approved / executed / rejected) behind the quiet History
 * link. Read-only by construction: PendingActionItem renders settled statuses
 * without review buttons.
 */
export function LiveApprovalHistoryContent() {
  const viewerReady = useViewerReady();
  const actions = useQuery(api.knowledge.pendingActionsForViewer, viewerReady ? { scope: "settled" } : "skip") as
    | AnyRecord[]
    | undefined;
  const reviewPendingActionMutation = useMutation(api.knowledge.reviewPendingActionForViewer);
  const reviewPendingAction = async (args: AnyRecord) => reviewPendingActionMutation(args as any);
  const sorted = (actions ?? [])
    .slice()
    .sort((a, b) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0));

  return (
    <LiveGate>
      {!actions ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading history</h2>
        </section>
      ) : sorted.length === 0 ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>No settled approvals yet</h2>
          <p className={mutedClass}>Approvals you approve or reject move here, out of the queue.</p>
        </section>
      ) : (
        <div className={itemListClass}>
          {sorted.map((action) => (
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
  // Calendar actions store the executor payload as JSON in `body`; decode it
  // for display instead of dumping it (docs/ui-audit). Null falls through to
  // the raw text so a malformed payload stays visible.
  const calendarEvent = parseCalendarActionBody(action);
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
    <article className={cn(itemClass, pendingActionItemClass)}>
      <span className={itemIconClass}>
        {calendarEvent ? <icons.CalendarDays size={17} aria-hidden /> : <icons.MessageSquareText size={17} aria-hidden />}
      </span>
      <div className={formGridClass}>
        <div>
          <p className={itemTitleClass}>{calendarEvent?.summary ?? action.subject ?? action.actionType}</p>
          {calendarEvent ? (
            <>
              <p className={itemMetaClass}>{formatEventWhen(calendarEvent)}</p>
              {calendarEvent.location ? (
                <p className={itemMetaClass}>
                  <icons.MapPin size={13} aria-hidden className="mr-1 inline-block align-[-2px]" />
                  {calendarEvent.location}
                </p>
              ) : null}
              {calendarEvent.description ? <p className={itemMetaClass}>{calendarEvent.description}</p> : null}
            </>
          ) : (
            <p className={itemMetaClass}>{primaryText}</p>
          )}
        </div>
        {/* Rendered above the form on purpose: the point of the warning is to be
            read BEFORE the Approve button, not discovered after the tap. */}
        {typeof action.reviewWarning === "string" && action.reviewWarning ? (
          <p className={reviewWarningClass}>{action.reviewWarning}</p>
        ) : null}
        {!reviewable ? (
          <p className={mutedClass}>{statusDescription(action)}</p>
        ) : calendarEvent ? (
          /* No payload form for calendar actions: the executor parses `body`
             as JSON, so the only safe edit here is the owner's own note. */
          <div className={formGridClass}>
            <label className={fieldClass}>
              <span>Review notes</span>
              <input className={inputClass} value={draft.approvalNotes} onChange={(event) => update("approvalNotes", event.target.value)} />
            </label>
            {error ? <p className={errorTextClass}>{error}</p> : null}
          </div>
        ) : (
          <div className={formGridClass}>
            <div className={splitListClass}>
              <label className={fieldClass}>
                <span>Recipients</span>
                <input className={inputClass} value={draft.recipients} onChange={(event) => update("recipients", event.target.value)} />
              </label>
              <label className={fieldClass}>
                <span>Subject</span>
                <input className={inputClass} value={draft.subject} onChange={(event) => update("subject", event.target.value)} />
              </label>
            </div>
            <label className={fieldClass}>
              <span>Message</span>
              <textarea className={textareaClass} value={draft.messageBody || draft.body} onChange={(event) => update("messageBody", event.target.value)} />
            </label>
            <label className={fieldClass}>
              <span>Review notes</span>
              <input className={inputClass} value={draft.approvalNotes} onChange={(event) => update("approvalNotes", event.target.value)} />
            </label>
            {error ? <p className={errorTextClass}>{error}</p> : null}
          </div>
        )}
      </div>
      <div className={pendingActionSideClass}>
        <span className={cn(badgeClass, badgeForPendingAction(action.status))}>{action.status}</span>
        {reviewable ? (
          <div className={toolbarClass} aria-label={`Review actions for ${action.subject ?? action.actionType}`}>
            <button
              className={cn(textButtonClass, textButtonCompactClass, "border-primary")}
              type="button"
              aria-label={`Approve ${action.subject ?? action.actionType}`}
              disabled={Boolean(busyAction)}
              onClick={() => void submit("approve")}
            >
              Approve
            </button>
            {!calendarEvent ? (
              <button
                className={cn(textButtonClass, textButtonCompactClass)}
                type="button"
                aria-label={`Save revisions for ${action.subject ?? action.actionType}`}
                disabled={Boolean(busyAction)}
                onClick={() => void submit("revise")}
              >
                Save changes
              </button>
            ) : null}
            <button
              className={cn(textButtonClass, textButtonCompactClass)}
              type="button"
              aria-label={`Reject ${action.subject ?? action.actionType}`}
              disabled={Boolean(busyAction)}
              onClick={() => void submit("reject")}
            >
              Reject
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
  // Palette lanes (docs/ui-audit): green = settled/approved, red = rejected or
  // failed, gold = still needs the owner's attention.
  if (status === "approved" || status === "sent" || status === "completed") {
    return badgeGreenClass;
  }
  if (status === "rejected" || status === "failed") {
    return badgeRedClass;
  }
  return badgeGoldClass;
}

function statusDescription(action: AnyRecord) {
  if (action.status === "approved") {
    return action.actionType === "calendar_event_create"
      ? "Approved — on its way to your calendar."
      : "Approved and waiting for execution.";
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
  const harnessAutonomyPolicy = {
    ...defaultHarnessAutonomyPolicy,
    ...(config?.harnessAutonomyPolicy ?? {}),
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
            <h2>Harness autonomy</h2>
            <p className={mutedClass}>How much local harnesses may do before asking you to review.</p>
            <div className={formGridClass}>
              <label className={fieldClass}>
                <span>Memory ingestion</span>
                <select
                  className={selectClass}
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
              <label className={fieldClass}>
                <span>External actions</span>
                <select
                  className={selectClass}
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
              <label className={fieldClass}>
                <span>Autonomy notes</span>
                <textarea
                  className={textareaClass}
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
            checked={preferences.pendingActionEnabled}
            onChange={(event) => void setPreference("pendingActionEnabled", event.target.checked)}
          />
          <span>Pending actions</span>
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
