"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Bell, Check, Copy, Download, Inbox, Paperclip, PenLine, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { activeSourceSyncStatus, type QuickCaptureIntent } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { focusItemKey, parseFocusSummary } from "../focus-summary";
import { LiveGate } from "../live-auth";
import { Badge, Button, Card, EmptyState, IconButton, InlineMarkdown, LoadingRow, Section, TextArea, useToast, type BadgeTone } from "../components";
import { useViewerReady } from "./use-viewer";
import { formatFileSize } from "./project-library-helpers";
import { QUICK_CAPTURE_INTENT_STORAGE_KEY, checkQuickCaptureFile, parseStoredIntent } from "./quick-capture-helpers";
import todayStyles from "./today.module.css";

type AnyRecord = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Quick capture: a quiet inbox slot on the home page — one inbox, two */
/* intents. "Remember" items land as pending quickCaptures for the     */
/* ingestion harnesses; "Hold" items are private device-to-device      */
/* transfers that harnesses never see and that expire after 7 days.    */
/* The card doubles as a dropzone/paste target for files.              */
/* ------------------------------------------------------------------ */

const captureTone: Record<string, BadgeTone> = {
  pending: "gold",
  processed: "green",
  discarded: "neutral",
};

const CAPTURE_LIST_LIMIT = 6;

function captureLabel(capture: AnyRecord): string {
  return capture.text ?? capture.fileName ?? capture.url ?? "File";
}

function QuickCaptureBox({ captures }: { captures: AnyRecord[] | undefined }) {
  const generateUploadUrl = useMutation(api.knowledge.generateQuickCaptureUploadUrlForViewer);
  const createCapture = useMutation(api.knowledge.createQuickCaptureForViewer);
  const deleteCapture = useMutation(api.knowledge.deleteQuickCaptureForViewer);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [intent, setIntent] = useState<QuickCaptureIntent>("remember");
  const [busyCaptureId, setBusyCaptureId] = useState<string | null>(null);

  // Sticky per device. Read in an effect so the server render and hydration
  // both see the "remember" default (localStorage is browser-only).
  useEffect(() => {
    setIntent(parseStoredIntent(window.localStorage.getItem(QUICK_CAPTURE_INTENT_STORAGE_KEY)));
  }, []);

  const chooseIntent = (next: QuickCaptureIntent) => {
    setIntent(next);
    try {
      window.localStorage.setItem(QUICK_CAPTURE_INTENT_STORAGE_KEY, next);
    } catch {
      // Private mode etc. — the toggle still works for this page view.
    }
  };

  const canSubmit = !submitting && (text.trim().length > 0 || file !== null);

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const check = checkQuickCaptureFile({
      fileName: candidate.name || "pasted-file",
      mimeType: candidate.type,
      sizeBytes: candidate.size,
    });
    if (!check.ok) {
      toast(check.reason, "error");
      return;
    }
    setFile(candidate);
  };

  /* Dropzone: depth counter so the highlight doesn't flicker while the drag
     moves over child elements (enter/leave fire per descendant). */
  const dragHasFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault(); // required for the drop event to fire
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    // First file when several are dropped — the box holds one attachment.
    selectFile(event.dataTransfer?.files?.[0]);
  };

  /* Clipboard: pasting a file/image (e.g. a screenshot) attaches it. */
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === "file");
    const pasted = item?.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    selectFile(pasted);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Same upload flow as the project library: upload URL → POST bytes → register.
      let fileArgs: AnyRecord = {};
      if (file) {
        const check = checkQuickCaptureFile({
          fileName: file.name || "pasted-file",
          mimeType: file.type,
          sizeBytes: file.size,
        });
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
      await createCapture({ ...(trimmed ? { text: trimmed } : {}), ...fileArgs, intent } as any);
      setText("");
      clearFile();
      toast(
        intent === "hold"
          ? "Held — grab it from any device within 7 days. Skippy won't ingest it."
          : "Captured — Skippy will pick it up on the next ingestion run.",
        "info",
      );
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

  const copyCapture = async (capture: AnyRecord) => {
    try {
      await navigator.clipboard.writeText(capture.text ?? capture.url ?? "");
      toast("Copied to clipboard.", "info");
    } catch {
      toast("Could not copy — clipboard unavailable.", "error");
    }
  };

  const downloadCapture = async (capture: AnyRecord) => {
    if (!capture.fileUrl) return;
    setBusyCaptureId(capture._id);
    try {
      // Convex file URLs are cross-origin, so an anchor download attribute
      // cannot rename the file — fetch to a blob and download the object URL
      // instead, preserving the real filename.
      const response = await fetch(capture.fileUrl);
      if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = capture.fileName ?? "capture";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not download file", "error");
    } finally {
      setBusyCaptureId(null);
    }
  };

  const removeCapture = async (capture: AnyRecord) => {
    setBusyCaptureId(capture._id);
    try {
      await deleteCapture({ captureId: capture._id } as any);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete capture", "error");
    } finally {
      setBusyCaptureId(null);
    }
  };

  // Pending items of both intents plus recently processed ones. Discarded
  // rows stay out of sight; expired holds never arrive from the server.
  const visible = (captures ?? []).filter(
    (capture) => capture.status === "pending" || capture.status === "processed",
  );
  const recent = visible.slice(0, CAPTURE_LIST_LIMIT);
  const moreCount = visible.length - recent.length;

  return (
    <Section
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PenLine size={18} aria-hidden /> Quick capture
        </span>
      }
    >
      <div
        className={`${todayStyles.captureDropzone}${dragActive ? ` ${todayStyles.captureDropzoneActive}` : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        <TextArea
          rows={2}
          placeholder="Drop a thought, note, URL, or file…"
          aria-label="Quick capture text"
          value={text}
          disabled={submitting}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onTextKeyDown}
        />
        <div className={todayStyles.captureActions}>
          <div className={todayStyles.intentToggle} role="radiogroup" aria-label="Capture intent">
            <button
              type="button"
              role="radio"
              aria-checked={intent === "remember"}
              disabled={submitting}
              onClick={() => chooseIntent("remember")}
            >
              Remember
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={intent === "hold"}
              disabled={submitting}
              onClick={() => chooseIntent("hold")}
            >
              Hold
            </button>
          </div>
          <span className={todayStyles.captureActionsRight}>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                if (event.target) event.target.value = "";
              }}
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
          </span>
        </div>
        {intent === "hold" ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Hold keeps this private for cross-device transfer — Skippy won&apos;t ingest it, and it
            expires after 7 days.
          </p>
        ) : null}
        {recent.length ? (
          <div style={{ display: "grid", gap: 4 }}>
            {recent.map((capture) => {
              const label = captureLabel(capture);
              const busy = busyCaptureId === capture._id;
              return (
                <div key={capture._id} className={todayStyles.captureRow}>
                  <span className={todayStyles.captureText} title={label}>
                    {label}
                  </span>
                  {typeof capture.sizeBytes === "number" ? (
                    <span className="item-meta">{formatFileSize(capture.sizeBytes)}</span>
                  ) : null}
                  {capture.intent === "hold" ? (
                    <Badge tone="neutral">hold</Badge>
                  ) : (
                    <Badge tone={captureTone[capture.status] ?? "neutral"}>{capture.status}</Badge>
                  )}
                  <span className={todayStyles.captureRowActions}>
                    {capture.text || capture.url ? (
                      <IconButton
                        small
                        title="Copy text"
                        aria-label={`Copy ${label}`}
                        disabled={busy}
                        onClick={() => void copyCapture(capture)}
                      >
                        <Copy size={13} aria-hidden />
                      </IconButton>
                    ) : null}
                    {capture.fileUrl && capture.fileName ? (
                      <IconButton
                        small
                        title={`Download ${capture.fileName}`}
                        aria-label={`Download ${capture.fileName}`}
                        disabled={busy}
                        onClick={() => void downloadCapture(capture)}
                      >
                        <Download size={13} aria-hidden />
                      </IconButton>
                    ) : null}
                    <IconButton
                      small
                      title="Delete capture"
                      aria-label={`Delete ${label}`}
                      disabled={busy}
                      onClick={() => void removeCapture(capture)}
                    >
                      <X size={13} aria-hidden />
                    </IconButton>
                  </span>
                </div>
              );
            })}
            {moreCount > 0 ? (
              <p className="item-meta" style={{ margin: 0 }}>
                +{moreCount} more
              </p>
            ) : null}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Captures wait here until an ingestion run files them into Skippy. Held items stay for
            you to grab on another device.
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * One-shot toast for the Web Share Target round-trip: /share redirects to
 * /?shared=ok|err, we surface the result and strip the param. The query is
 * read from window.location in an effect (not useSearchParams) so the static
 * home page needs no Suspense boundary.
 */
function useSharedParamToast() {
  const toast = useToast();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("shared");
    if (!shared) return;
    handled.current = true;
    if (shared === "ok") {
      toast("Captured from share — Skippy will pick it up on the next ingestion run.", "info");
    } else {
      toast("Share failed — nothing was captured.", "error");
    }
    params.delete("shared");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }, [router, toast]);
}

export function TodayContent() {
  const viewerReady = useViewerReady();
  useSharedParamToast();
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
  // Stale running rows (dead harness, no heartbeat) read as inactive — the
  // "Updating" pill self-heals instead of pinning forever.
  const sync = useMemo(
    () => activeSourceSyncStatus<AnyRecord>(data?.sourceSyncStatuses, Date.now()),
    [data?.sourceSyncStatuses],
  );
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
