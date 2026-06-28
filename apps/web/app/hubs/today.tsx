"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Bell, Check, Inbox, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { focusItemKey, parseFocusSummary } from "../focus-summary";
import { LiveGate } from "../live-auth";
import { Badge, Card, EmptyState, IconButton, LoadingRow, Section } from "../components";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;

function activeSourceSyncStatus(statuses: AnyRecord[] | undefined) {
  const running = (statuses ?? [])
    .filter((status) => status.status === "running")
    .sort((l, r) => (r.lastHeartbeatAt ?? r.updatedAt ?? 0) - (l.lastHeartbeatAt ?? l.updatedAt ?? 0));
  return running[0] ?? null;
}

export function TodayContent() {
  const viewerReady = useViewerReady();
  const data = useQuery(api.knowledge.dashboardForViewer, viewerReady ? {} : "skip") as AnyRecord | undefined;
  const ready = useQuery(api.projects.readyTasksForViewer, viewerReady ? { limit: 6 } : "skip") as
    | AnyRecord[]
    | undefined;
  const projectsData = useQuery(api.knowledge.projectsAndTasksForViewer, viewerReady ? {} : "skip") as
    | AnyRecord
    | undefined;

  const recordFocusItemAction = useMutation(api.knowledge.recordFocusItemActionForViewer);
  const createTaskFromFocusItem = useMutation(api.knowledge.createTaskFromFocusItemForViewer);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { headline, bullets } = useMemo(
    () => parseFocusSummary(data?.focusSummary?.summaryText),
    [data?.focusSummary?.summaryText],
  );
  const sync = useMemo(() => activeSourceSyncStatus(data?.sourceSyncStatuses), [data?.sourceSyncStatuses]);
  const actionedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const action of data?.focusItemActions ?? []) set.add(action.itemKey);
    return set;
  }, [data?.focusItemActions]);
  const visibleBullets = useMemo(
    () => bullets.map((text) => ({ text, key: focusItemKey(text) })).filter((item) => !actionedKeys.has(item.key)),
    [bullets, actionedKeys],
  );

  const unclear = data?.triageItems?.length ?? 0;
  const pending = data?.pendingActions?.length ?? 0;
  const activeProjects = (projectsData?.projects ?? []).filter(
    (project: AnyRecord) => project.status === "in_progress" || project.status === "planned",
  );

  const recordAction = async (item: { text: string; key: string }, action: "dismissed" | "done") => {
    if (!data?.focusSummary?._id) return;
    setBusyKey(item.key);
    try {
      await recordFocusItemAction({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.key,
        itemText: item.text,
        action,
      } as any);
    } finally {
      setBusyKey(null);
    }
  };
  const promote = async (item: { text: string; key: string }) => {
    if (!data?.focusSummary?._id) return;
    setBusyKey(item.key);
    try {
      await createTaskFromFocusItem({
        focusSummaryId: data.focusSummary._id,
        itemKey: item.key,
        itemText: item.text,
      } as any);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <LiveGate>
      {!data ? (
        <Card>
          <LoadingRow label="Loading your focus…" />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }} className="today-grid">
          {/* Focus hero */}
          <section className="card section focus-summary" style={{ minHeight: 0 }}>
            <div>
              <div className="focus-summary-head">
                <p className="eyebrow">Now</p>
                {sync ? (
                  <span className="sync-status-pill" title={sync.message ?? "Source sync is running"}>
                    <RefreshCw size={14} aria-hidden /> Updating
                  </span>
                ) : null}
              </div>
              {sync ? (
                <p className="sync-status-copy">
                  {sync.message ?? `Checking ${(sync.sourceSystemsChecked ?? []).join(", ") || "connected sources"}.`}
                </p>
              ) : null}
              <h1 className="focus-heading">{visibleBullets.length ? headline : "Nothing new needs focus right now."}</h1>
              {visibleBullets.length ? (
                <ul className="focus-summary-list">
                  {visibleBullets.map((item) => (
                    <li key={item.key}>
                      <span>{item.text}</span>
                      <span className="focus-item-actions">
                        <IconButton
                          small
                          title="Dismiss from focus"
                          aria-label={`Dismiss ${item.text}`}
                          disabled={busyKey === item.key}
                          onClick={() => void recordAction(item, "dismissed")}
                        >
                          <X size={15} aria-hidden />
                        </IconButton>
                        <button
                          className="text-button compact"
                          type="button"
                          title="Turn into task"
                          disabled={busyKey === item.key}
                          onClick={() => void promote(item)}
                        >
                          Task
                        </button>
                        <IconButton
                          small
                          title="Already done"
                          aria-label={`Mark ${item.text} already done`}
                          disabled={busyKey === item.key}
                          onClick={() => void recordAction(item, "done")}
                        >
                          <Check size={15} aria-hidden />
                        </IconButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">New source items and remaining focus bullets appear here when they need attention.</p>
              )}
            </div>
          </section>

          {/* Right rail */}
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <Section
              title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Sparkles size={18} aria-hidden /> Ready to work
                </span>
              }
              action={
                <Link className="text-button compact" href="/projects">
                  Projects
                </Link>
              }
            >
              {ready === undefined ? (
                <LoadingRow />
              ) : ready.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  No unblocked agent tasks. Plan a project to generate executable task briefs.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {ready.map((task) => (
                    <Link
                      key={task._id}
                      className="item project-row"
                      href={task.projectId ? `/projects/${task.projectId}` : "/projects"}
                      style={{ gridTemplateColumns: "1fr auto" }}
                    >
                      <div>
                        <p className="item-title">{task.title}</p>
                        <p className="item-meta">{task.projectTitle ?? "Unassigned"}</p>
                      </div>
                      <span className="project-row-side">
                        {task.kind ? <Badge tone="blue">{task.kind}</Badge> : null}
                        <ArrowRight size={16} aria-hidden />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Needs your review">
              {unclear === 0 && pending === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  Inbox zero — nothing waiting for a decision.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {unclear > 0 ? (
                    <Link className="item project-row" href="/review" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                      <span className="item-icon">
                        <Inbox size={17} aria-hidden />
                      </span>
                      <div>
                        <p className="item-title">{unclear} unclear signal{unclear === 1 ? "" : "s"}</p>
                        <p className="item-meta">Need a rubric decision.</p>
                      </div>
                      <Badge tone="gold">Review</Badge>
                    </Link>
                  ) : null}
                  {pending > 0 ? (
                    <Link className="item project-row" href="/review" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                      <span className="item-icon">
                        <ShieldCheck size={17} aria-hidden />
                      </span>
                      <div>
                        <p className="item-title">{pending} pending action{pending === 1 ? "" : "s"}</p>
                        <p className="item-meta">External effects awaiting approval.</p>
                      </div>
                      <Badge tone="red">Approve</Badge>
                    </Link>
                  ) : null}
                </div>
              )}
            </Section>

            <Section
              title="Active projects"
              action={
                <Link className="text-button compact" href="/projects">
                  All
                </Link>
              }
            >
              {projectsData === undefined ? (
                <LoadingRow />
              ) : activeProjects.length === 0 ? (
                <EmptyState icon={<Bell size={20} aria-hidden />} title="No active projects">
                  Start one from the Projects hub and let Skippy plan it.
                </EmptyState>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {activeProjects.slice(0, 5).map((project: AnyRecord) => {
                    const tasks = (projectsData?.tasks ?? []).filter((task: AnyRecord) => task.projectId === project._id);
                    const total = tasks.length;
                    return (
                      <Link key={project._id} href={`/projects/${project._id}`} className="project-row" style={{ display: "grid", gap: 6, padding: "10px 0", textDecoration: "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <strong style={{ fontWeight: 720 }}>{project.title}</strong>
                          <Badge tone="blue">{String(project.status).replace(/_/g, " ")}</Badge>
                        </div>
                        <p className="item-meta" style={{ margin: 0 }}>
                          {total} open task{total === 1 ? "" : "s"}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        </div>
      )}
    </LiveGate>
  );
}
