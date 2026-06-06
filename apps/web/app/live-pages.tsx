"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../lib/skippy-api";
import { LiveGate } from "./live-auth";
import { icons } from "./ui";

type AnyRecord = Record<string, any>;

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
  const markDone = useMutation(api.knowledge.markTaskDoneForViewer);
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
          <span className="item-icon">
            <icons.Check size={17} aria-hidden />
          </span>
          <div>
            <p className="item-title">{task.title}</p>
            <p className="item-meta">{task.priorityReason ?? task.status}</p>
          </div>
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

  return (
    <LiveGate>
      {!items ? (
        <section className="card section">
          <h2>Loading triage</h2>
        </section>
      ) : (
        <div className="item-list">
          {items.length === 0 ? <p className="muted">No pending suggestions.</p> : null}
          {items.map((item) => (
            <TriageItem key={item._id} item={item} />
          ))}
        </div>
      )}
    </LiveGate>
  );
}

function TriageItem({ item }: { item: AnyRecord }) {
  const review = useMutation(api.knowledge.reviewTriageItem);
  const [targetEntityType, setTargetEntityType] = useState(item.candidateEntityType ?? "note");
  const [editedPayload, setEditedPayload] = useState(() =>
    editablePayloadFor(item.candidateEntityType ?? "note", item.candidatePayload ?? {}),
  );
  const [mergeTargetId, setMergeTargetId] = useState("");

  async function submit(action: "approve" | "reject" | "correct" | "merge" | "reclassify") {
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
    await review(args);
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
            <span>Merge target ID</span>
            <input className="input" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} />
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
            <article className="item" key={action._id}>
              <span className="item-icon">
                <icons.MessageSquareText size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{action.subject ?? action.actionType}</p>
                <p className="item-meta">{action.body ?? action.messageBody ?? action.status}</p>
              </div>
              <span className="badge red">{action.status}</span>
            </article>
          ))}
        </div>
      )}
    </LiveGate>
  );
}

export function LiveSettingsContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.settings.getSettings, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const updateConfig = useMutation(api.settings.updateConfig);
  const createToken = useMutation(api.mcpTokens.create);
  const revokeToken = useMutation(api.mcpTokens.revoke);
  const [label, setLabel] = useState("Local harness");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

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
                  onChange={(event) => void updateConfig({ llmProviderMode: event.target.value })}
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
