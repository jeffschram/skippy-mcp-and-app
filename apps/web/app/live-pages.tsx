"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../lib/skippy-api";
import { LiveGate } from "./live-auth";
import { icons } from "./ui";

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
  project: ["idea", "planned", "in_progress", "paused", "completed", "cancelled"],
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

function titleForTriage(item: AnyRecord) {
  const payload = item.candidatePayload ?? {};
  return payload.title ?? payload.name ?? payload.url ?? payload.body ?? "Untitled suggestion";
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
        status: textValue(payload.status) || "unread",
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
    titleForTriage(item),
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

export function LiveHomeContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.dashboardForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading focus</h2>
          <p className="muted">Waiting for the latest Convex snapshot.</p>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-8 focus-summary">
            <div>
              <h2>Current focus</h2>
              <p>
                {data.focusSummary?.summaryText ??
                  "No stored focus summary yet. A harness can generate one through the MCP."}
              </p>
            </div>
          </section>
          <section className="span-4 section">
            <h2>Review queue</h2>
            <div className="item-list">
              <div className="item">
                <span className="item-icon">
                  <icons.Archive size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{data.triageItems.length} suggestions</p>
                  <p className="item-meta">Awaiting triage review.</p>
                </div>
                <span className="badge gold">Triage</span>
              </div>
              <div className="item">
                <span className="item-icon">
                  <icons.MessageSquareText size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{data.pendingActions.length} pending actions</p>
                  <p className="item-meta">External effects stay separated until reviewed.</p>
                </div>
                <span className="badge red">Approval</span>
              </div>
            </div>
          </section>
          <section className="span-12">
            <h2>Top items</h2>
            <div className="item-list">
              {(data.focusSummary?.topItems?.length ? data.focusSummary.topItems : data.tasks).map(
                (item: AnyRecord) => (
                  <article className="item" key={item._id ?? item.reason ?? item.title}>
                    <span className="item-icon">
                      <icons.CircleCheck size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{item.title ?? item.entityRef?.entityType ?? "Focus item"}</p>
                      <p className="item-meta">{item.reason ?? item.priorityReason ?? item.status ?? "Accepted task"}</p>
                    </div>
                    <span className="badge blue">{item.priorityScore ?? item.status ?? "Focus"}</span>
                  </article>
                ),
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
  const markDoneMutation = useMutation(api.knowledge.markTaskDoneForViewer);
  const markDone = async (args: AnyRecord) => markDoneMutation({ taskId: args.taskId as any });
  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, AnyRecord[]>();
    for (const task of data?.tasks ?? []) {
      grouped.set(task.projectId ?? "unassigned", [...(grouped.get(task.projectId ?? "unassigned") ?? []), task]);
    }
    return grouped;
  }, [data?.tasks]);

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading projects</h2>
        </section>
      ) : (
        <div className="grid">
          {data.projects.map((project: AnyRecord) => (
            <section className="card section span-6" key={project._id}>
              <div className="settings-row">
                <div>
                  <h2>{project.title}</h2>
                  <p className="muted">{project.summary ?? "No summary yet."}</p>
                </div>
                <span className="badge blue">{project.status}</span>
              </div>
              <TaskList tasks={tasksByProject.get(project._id) ?? []} markDone={markDone} />
            </section>
          ))}
          <section className="card section span-6">
            <h2>Unassigned tasks</h2>
            <TaskList tasks={tasksByProject.get("unassigned") ?? []} markDone={markDone} />
          </section>
        </div>
      )}
    </LiveGate>
  );
}

function TaskList({ tasks, markDone }: { tasks: AnyRecord[]; markDone: (args: AnyRecord) => Promise<unknown> }) {
  if (tasks.length === 0) {
    return <p className="muted">No tasks here.</p>;
  }

  return (
    <div className="item-list">
      {tasks.map((task) => (
        <article className="item" key={task._id}>
          <span className={`item-icon ${task.status === "in_progress" ? "is-active" : ""}`}>
            {task.status === "in_progress" ? (
              <icons.Clock3 size={17} aria-hidden />
            ) : (
              <icons.Check size={17} aria-hidden />
            )}
          </span>
          <div>
            <p className="item-title">{task.title}</p>
            <p className="item-meta">
              {task.status === "in_progress"
                ? `In progress${task.startedBy ? ` by ${task.startedBy}` : ""}`
                : (task.priorityReason ?? task.status)}
            </p>
          </div>
          <span className={`badge ${task.status === "in_progress" ? "gold" : "blue"}`}>{task.status}</span>
          <button
            className="icon-button"
            type="button"
            title="Mark done"
            disabled={task.status === "done"}
            onClick={() => void markDone({ taskId: task._id })}
          >
            <icons.CircleCheck size={17} aria-hidden />
          </button>
        </article>
      ))}
    </div>
  );
}

export function LiveContactsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.contactsForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading contacts</h2>
        </section>
      ) : (
        <div className="split-list">
          <ContactList title="People" items={data.people} icon="UserRound" labelField="name" />
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
}: {
  title: string;
  items: AnyRecord[];
  icon: "UserRound" | "LinkIcon";
  labelField: string;
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
            <span className="badge">{item.relationshipLabel ?? item.roleTitle ?? "Contact"}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LiveTriageContent() {
  const viewerReady = useViewerReady();
  const items = useQuery(api.knowledge.triageForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;
  const entityOptions = useQuery(api.knowledge.acceptedEntityOptionsForViewer, viewerReady ? {} : "skip") as AnyRecord[] | undefined;

  return (
    <LiveGate>
      {!items || !entityOptions ? (
        <section className="card section">
          <h2>Loading triage</h2>
        </section>
      ) : (
        <div className="item-list">
          {items.length === 0 ? <p className="muted">No pending suggestions.</p> : null}
          {items.map((item) => (
            <TriageItem key={item._id} item={item} entityOptions={entityOptions} />
          ))}
        </div>
      )}
    </LiveGate>
  );
}

function TriageItem({ item, entityOptions }: { item: AnyRecord; entityOptions: AnyRecord[] }) {
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
          <p className="item-title">{titleForTriage(item)}</p>
          <p className="item-meta">
            {item.candidateEntityType} candidate
            {item.confidence ? `, confidence ${Math.round(item.confidence * 100)}%` : ""}
          </p>
        </div>
        <PayloadEditor entityType={targetEntityType} payload={editedPayload} setPayload={setEditedPayload} />
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
      <div className="toolbar" aria-label={`Review actions for ${titleForTriage(item)}`}>
        <button
          className="icon-button"
          type="button"
          title="Approve as-is"
          aria-label={`Approve ${titleForTriage(item)} as-is`}
          onClick={() => void submit("approve")}
        >
          <icons.Check size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Approve with edited payload"
          aria-label={`Approve ${titleForTriage(item)} with edited payload`}
          onClick={() => void submit("correct")}
        >
          <icons.CircleCheck size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Reclassify to selected target type"
          aria-label={`Reclassify ${titleForTriage(item)} to selected target type`}
          onClick={() => void submit("reclassify")}
        >
          <icons.Shuffle size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Merge into target ID"
          aria-label={`Merge ${titleForTriage(item)} into target ID`}
          disabled={!mergeTargetId}
          onClick={() => void submit("merge")}
        >
          <icons.LinkIcon size={17} aria-hidden />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Reject candidate"
          aria-label={`Reject ${titleForTriage(item)}`}
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
}: {
  entityType: string;
  payload: AnyRecord;
  setPayload: (payload: AnyRecord) => void;
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
    return (
      <div className="form-grid compact-form">
        {field("title", "Title")}
        <div className="split-list">
          {status}
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

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function LiveSettingsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.settings.getSettings, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const updateConfig = useMutation(api.settings.updateConfig);
  const upsertPushSubscription = useMutation(api.settings.upsertPushSubscription);
  const disablePushSubscription = useMutation(api.settings.disablePushSubscription);
  const createToken = useMutation(api.mcpTokens.create);
  const revokeToken = useMutation(api.mcpTokens.revoke);
  const [label, setLabel] = useState("Local harness");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );

  return (
    <LiveGate>
      {!data ? (
        <section className="card section">
          <h2>Loading settings</h2>
        </section>
      ) : (
        <div className="grid">
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
