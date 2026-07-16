"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Bell, Check, Inbox, Paperclip, PenLine, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { focusItemKey, parseFocusSummary } from "../focus-summary";
import { LiveGate } from "../live-auth";
import { Badge, Button, Card, EmptyState, IconButton, InlineMarkdown, LoadingRow, Section, TextArea, useToast, type BadgeTone } from "../components";
import { useViewerReady } from "./use-viewer";
import { PROJECT_FILE_ACCEPT, checkProjectFile, formatFileSize } from "./project-library-helpers";
import todayStyles from "./today.module.css";

type AnyRecord = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Quick capture: a quiet inbox slot on the home page. Text/URLs/files */
/* land as pending quickCaptures; ingestion harnesses turn useful ones */
/* into Skippy objects later and mark them processed or discarded.     */
/* ------------------------------------------------------------------ */

const captureTone: Record<string, BadgeTone> = {
  pending: "gold",
  processed: "green",
  discarded: "neutral",
};

function QuickCaptureBox({ captures }: { captures: AnyRecord[] | undefined }) {
  const generateUploadUrl = useMutation(api.knowledge.generateQuickCaptureUploadUrlForViewer);
  const createCapture = useMutation(api.knowledge.createQuickCaptureForViewer);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !submitting && (text.trim().length > 0 || file !== null);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Same upload flow as the project library: upload URL → POST bytes → register.
      let fileArgs: AnyRecord = {};
      if (file) {
        const check = checkProjectFile({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
        if (!check.ok) throw new Error(check.reason);
        const uploadUrl = (await generateUploadUrl({})) as string;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": check.mimeType },
          body: file,
        });
        if (!response.ok) throw new Error(`upload failed (HTTP ${response.status})`);
        const { storageId } = (await response.json()) as { storageId: string };
        fileArgs = { storageId, fileName: check.fileName, mimeType: check.mimeType, sizeBytes: check.sizeBytes };
      }
      const trimmed = text.trim();
      await createCapture({ ...(trimmed ? { text: trimmed } : {}), ...fileArgs } as any);
      setText("");
      clearFile();
      toast("Captured — Skippy will pick it up on the next ingestion run.", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save capture", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const recent = (captures ?? []).slice(0, 5);

  return (
    <Section
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PenLine size={18} aria-hidden /> Quick capture
        </span>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        <TextArea
          rows={2}
          placeholder="Drop a thought, note, or URL to remember later…"
          aria-label="Quick capture text"
          value={text}
          disabled={submitting}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onTextKeyDown}
        />
        <div className={todayStyles.captureActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept={PROJECT_FILE_ACCEPT}
            style={{ display: "none" }}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <span className={todayStyles.captureFile}>
              <Paperclip size={13} aria-hidden />
              <span className={todayStyles.captureFileName}>{file.name}</span>
              <span className="item-meta">{formatFileSize(file.size)}</span>
              <IconButton small aria-label={`Remove ${file.name}`} disabled={submitting} onClick={clearFile}>
                <X size={13} aria-hidden />
              </IconButton>
            </span>
          ) : (
            <button
              type="button"
              className="text-button compact"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} aria-hidden /> Attach file
            </button>
          )}
          <Button small disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Capturing…" : "Capture"}
          </Button>
        </div>
        {recent.length ? (
          <div style={{ display: "grid", gap: 4 }}>
            {recent.map((capture) => (
              <div key={capture._id} className={todayStyles.captureRow}>
                <span className={todayStyles.captureText} title={capture.text ?? capture.fileName ?? capture.url}>
                  {capture.text ?? capture.fileName ?? capture.url ?? "File"}
                </span>
                <Badge tone={captureTone[capture.status] ?? "neutral"}>{capture.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Captures wait here until an ingestion run files them into Skippy.
          </p>
        )}
      </div>
    </Section>
  );
}

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
    // Dismissals from recent prior summaries: regenerated bullets with the exact same
    // text must never flash back.
    for (const dismissal of data?.recentFocusDismissals ?? []) {
      if (dismissal.itemKey) set.add(dismissal.itemKey);
    }
    return set;
  }, [data?.focusItemActions, data?.recentFocusDismissals]);
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
        <div className={todayStyles.grid}>
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
              <h1 className="focus-heading">
                {visibleBullets.length ? <InlineMarkdown>{headline}</InlineMarkdown> : "Nothing new needs focus right now."}
              </h1>
              {visibleBullets.length ? (
                <ul className="focus-summary-list">
                  {visibleBullets.map((item) => (
                    <li key={item.key}>
                      <span>
                        <InlineMarkdown>{item.text}</InlineMarkdown>
                      </span>
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
          <div className={todayStyles.rail}>
            <QuickCaptureBox captures={data?.quickCaptures} />

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
