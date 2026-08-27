"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Ban,
  Check,
  Circle,
  ExternalLink,
  FilePenLine,
  GitBranch,
  GitMerge,
  GitPullRequest,
  ListChecks,
  Loader2,
  Minus,
  Pencil,
  Play,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown, ChatMarkdownInline } from "../../lib/chat-markdown";
import { api } from "../../lib/skippy-api";
import {
  summarizeChatActivity,
  type ChatActivityLine,
} from "../../lib/chat-activity";
import {
  EXECUTION_COLUMNS,
  executionStateTone,
  titleCase,
} from "../../lib/display";
import {
  ApprovalCard,
  Badge,
  Button,
  Field,
  Select,
  TextArea,
  useSettlingApprovals,
  useToast,
} from "../components";
import { approvalsForTask } from "../../lib/approvals";
import { useViewerReady } from "./use-viewer";
import {
  canAbandon,
  canConfirmCloseout,
  canEditBrief,
  criteriaDraftFrom,
  parseCriteria,
  prDisplay,
  primaryTaskAction,
  truncateMiddle,
} from "./task-detail-helpers";

type AnyRecord = Record<string, any>;

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm">{title}</h3>
      {children}
    </section>
  );
}

/** Run statuses where the harness may still emit events. */
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "claimed",
  "preparing",
  "running",
  "waiting_for_approval",
  "verifying",
  "awaiting_publish_approval",
  "publishing",
]);

/** Parked runs are waiting on the owner, not working. */
const PARKED_RUN_STATUSES = new Set([
  "waiting_for_approval",
  "awaiting_publish_approval",
]);

/** Newest events kept live in the panel; summarization trims further. */
const RUN_EVENT_TAIL = 80;

function runActivityLineIcon(line: ChatActivityLine) {
  switch (line.kind) {
    case "command":
      return <TerminalSquare size={13} aria-hidden className="mt-0.5 shrink-0" />;
    case "file_change":
      return <FilePenLine size={13} aria-hidden className="mt-0.5 shrink-0" />;
    default:
      return <Sparkles size={13} aria-hidden className="mt-0.5 shrink-0" />;
  }
}

/**
 * Live narration for an in-progress agent task: latest narration line, a
 * short tail of recent actions, and plan progress, streaming from the run's
 * agentRunEvents. The chat shows only compact lifecycle notices; this panel
 * is where the owner watches the run.
 *
 * Mounted by TaskDetailPanel only while the task is in_progress AND
 * agent-owned (the parent gates via this child so hook order stays stable).
 * It renders nothing when no run exists or the run has already settled, so
 * a terminal state cleanly reverts to the panel's result/PR sections.
 */
function TaskRunActivity({ taskId }: { taskId: string }) {
  const viewerReady = useViewerReady();
  const runInfo = useQuery(
    api.agentWorkbench.runForTaskForViewer,
    viewerReady ? { taskId: taskId as any } : "skip",
  ) as AnyRecord | null | undefined;
  const run: AnyRecord | undefined = runInfo?.run;
  const active = Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
  // Subscribe to events only while the run can still produce them; the tail
  // arg keeps long runs from streaming their whole history to the client.
  const eventsData = useQuery(
    api.agentWorkbench.runEventsForViewer,
    active ? { runId: run!._id as any, tail: RUN_EVENT_TAIL } : "skip",
  ) as AnyRecord | undefined;
  const events: AnyRecord[] = eventsData?.events ?? [];
  const activity = useMemo(() => summarizeChatActivity(events, 6), [events]);
  if (!active) return null;
  const parked = PARKED_RUN_STATUSES.has(run!.status);
  return (
    <DetailSection title="Live activity">
      <div className="grid gap-2">
        {activity.narration ? (
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {activity.narration}
          </p>
        ) : null}
        {/* Echoes the chat LiveActivity dashed inner panel. */}
        <div className="grid gap-1 rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] px-3 py-2">
          {activity.plan ? (
            <p className="m-0 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ListChecks size={13} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                {activity.plan.done}/{activity.plan.total}
                {activity.plan.current ? ` — ${activity.plan.current}` : " done"}
              </span>
            </p>
          ) : null}
          {activity.lines.map((line, index) => (
            <p
              key={`${line.kind}:${index}:${line.text}`}
              className={cn(
                "m-0 flex items-start gap-1.5 text-xs",
                line.kind === "error" ? "text-destructive" : "text-muted-foreground",
                line.kind === "command" && "font-mono",
              )}
            >
              {runActivityLineIcon(line)}
              <span className="min-w-0 break-words">
                {line.kind === "command" ? `$ ${line.text}` : line.text}
              </span>
            </p>
          ))}
          {parked ? (
            // A parked run reads "waiting on you" — the approval card below
            // carries the urgency, so no working pulse here.
            <p className="m-0 text-xs font-bold text-muted-foreground">
              Paused — waiting on your approval
            </p>
          ) : (
            <p className="m-0 text-xs font-bold text-primary animate-pulse">
              Working…
            </p>
          )}
        </div>
      </div>
    </DetailSection>
  );
}

/** Close-out job statuses where the ritual is queued or moving. */
const CLOSEOUT_ACTIVE_STATUSES = new Set(["queued", "claimed", "running"]);

function closeoutStepIcon(status: string) {
  switch (status) {
    case "ok":
      return <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-primary" />;
    case "failed":
      return <X size={13} aria-hidden className="mt-0.5 shrink-0 text-destructive" />;
    case "running":
      return <Loader2 size={13} aria-hidden className="mt-0.5 shrink-0 animate-spin text-primary" />;
    case "skipped":
      return <Minus size={13} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />;
    default:
      return <Circle size={13} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground/50" />;
  }
}

/**
 * Post-merge close-out surface for an in_review task with a PR: the
 * "Confirm merge & close out" button enqueues the host-executed maintenance
 * job (the scripted ritual: verify merged → pull main → conditional runner
 * rebuild + deferred restart → worktree/branch cleanup → mark done with
 * prStatus merged), and the job's checklist streams back here step by step
 * like run narration. A failed job leaves the task in_review with the error
 * visible and offers a retry; a completed job flips the task to done, which
 * unmounts this section via the parent's in_review gate.
 *
 * The button shows regardless of the stored prStatus (which lags the actual
 * merge on GitHub) — the RUNNER verifies the real merge state via gh and
 * refuses politely when the PR is still open.
 */
function TaskCloseout({ taskId }: { taskId: string }) {
  const viewerReady = useViewerReady();
  const job = useQuery(
    api.agentWorkbench.closeoutJobForTaskForViewer,
    viewerReady ? { taskId: taskId as any } : "skip",
  ) as AnyRecord | null | undefined;
  const enqueueCloseout = useMutation(api.agentWorkbench.enqueueCloseoutForViewer);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const active = Boolean(job && CLOSEOUT_ACTIVE_STATUSES.has(job.status));
  const failed = job?.status === "failed";
  // Steps show while the ritual runs or after it failed. A stale completed
  // job (task back in review after a new attempt) renders the button only.
  const steps: AnyRecord[] = active || failed ? (job?.steps ?? []) : [];

  const confirm = async () => {
    setSubmitting(true);
    try {
      await enqueueCloseout({ taskId: taskId as any });
      toast("Close-out queued — the runner will verify the merge and clean up.", "success");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not queue close-out",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DetailSection title="Merge close-out">
      <div className="grid gap-2">
        {steps.length ? (
          // Echoes the live-activity dashed panel so close-out progress reads
          // like run narration.
          <div className="grid gap-1 rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] px-3 py-2">
            {steps.map((step) => (
              <p
                key={step.key}
                className={cn(
                  "m-0 flex items-start gap-1.5 text-xs",
                  step.status === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {closeoutStepIcon(step.status)}
                <span className="min-w-0 break-words">
                  {step.label}
                  {step.detail ? (
                    <span className="text-muted-foreground/80"> — {step.detail}</span>
                  ) : null}
                </span>
              </p>
            ))}
            {active ? (
              <p className="m-0 text-xs font-bold text-primary animate-pulse">
                {job?.status === "queued" ? "Waiting for the runner…" : "Closing out…"}
              </p>
            ) : null}
          </div>
        ) : null}
        {failed && job?.errorMessage ? (
          <p className="m-0 text-xs font-bold text-destructive">{job.errorMessage}</p>
        ) : null}
        {!active ? (
          <div>
            <Button variant="primary" disabled={submitting} onClick={() => void confirm()}>
              <GitMerge size={15} aria-hidden />
              {failed ? "Retry close-out" : "Confirm merge & close out"}
            </Button>
            <p className="mb-0 mt-1.5 text-xs text-muted-foreground">
              Verifies the PR is merged, pulls main, rebuilds the runner if it
              changed, removes the worktree, and marks the task done.
            </p>
          </div>
        ) : null}
      </div>
    </DetailSection>
  );
}

/**
 * Per-task detail view that swaps into the chat's slot on the project board.
 * Ported from the pre-v2 task drawer: brief editing, state moves, abandon,
 * and start/complete. "Copy brief", proposal editing, and the manual
 * "record result" form from the old drawer are consciously omitted — the
 * chat workspace now runs and records agent work, so those supervision
 * affordances no longer fit this surface.
 */
export function TaskDetailPanel({
  task,
  busy,
  onBack,
  onStart,
  onComplete,
  approvals,
  className,
}: {
  task: AnyRecord;
  busy: boolean;
  onBack: () => void;
  onStart: () => void;
  onComplete: () => void;
  /** Run approvals for the project (approvalsForProjectForViewer). */
  approvals?: AnyRecord[] | undefined;
  className?: string | undefined;
}) {
  const viewerReady = useViewerReady();
  // Board task fields cover most of the panel; the brief query adds
  // dependency status (and keeps parity with the pre-v2 drawer data source).
  const detail = useQuery(
    api.projects.getTaskBriefForViewer,
    viewerReady ? { taskId: task._id as any } : "skip",
  ) as AnyRecord | null | undefined;
  const updateBrief = useMutation(api.projects.updateTaskBriefForViewer);
  const setExecState = useMutation(api.projects.setTaskExecutionStateForViewer);
  const cancelTask = useMutation(api.projects.cancelTaskForViewer);
  const toast = useToast();

  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [abandonConfirming, setAbandonConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset transient edit state whenever a different task opens.
  useEffect(() => {
    setEditingBrief(false);
    setAbandonConfirming(false);
  }, [task._id]);

  // The 'Confirm?' abandon state resets on its own after a moment.
  useEffect(() => {
    if (!abandonConfirming) return;
    const timer = window.setTimeout(() => setAbandonConfirming(false), 3500);
    return () => window.clearTimeout(timer);
  }, [abandonConfirming]);

  const pending = busy || saving;
  const action = primaryTaskAction(task);
  const pr = prDisplay(task);
  const dependencies: AnyRecord[] = detail?.dependencies ?? [];
  // Pending gates for this task's run. Settled approvals are filtered out at
  // render (the query still returns them): a decided card fades out and is
  // gone — its durable record is the run/task activity history.
  const forTask = useMemo(
    () => approvalsForTask(approvals ?? [], task._id as string),
    [approvals, task._id],
  );
  const { approvals: taskApprovals, leavingIds } =
    useSettlingApprovals(forTask);

  const startEditingBrief = () => {
    setBriefDraft(task.executionBrief ?? "");
    setCriteriaDraft(criteriaDraftFrom(task.acceptanceCriteria));
    setEditingBrief(true);
  };

  const saveBrief = async () => {
    setSaving(true);
    try {
      await updateBrief({
        taskId: task._id as any,
        executionBrief: briefDraft,
        acceptanceCriteria: parseCriteria(criteriaDraft),
      } as any);
      toast("Brief updated.", "success");
      setEditingBrief(false);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not save brief",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const moveTo = async (state: string) => {
    if (state === task.executionState) return;
    setSaving(true);
    try {
      await setExecState({
        taskId: task._id as any,
        executionState: state as any,
      });
      toast(`Moved to ${titleCase(state)}.`, "info");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not move task",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const abandon = async () => {
    setSaving(true);
    try {
      await cancelTask({ taskId: task._id as any });
      setAbandonConfirming(false);
      toast("Task abandoned.", "info");
      onBack();
    } catch (error) {
      setAbandonConfirming(false);
      toast(
        error instanceof Error ? error.message : "Could not abandon task",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden bg-background", className)}
      aria-label="Task details"
    >
      <header className="flex min-h-14 items-center gap-2 border-b bg-card px-3">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden /> Back to chat
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 desk:p-6">
        <div>
          <h2 className="m-0 text-xl leading-snug">{task.title}</h2>
          {/* One meta row: status pills on the left, PR facts (link, status
              chip, branch) pushed right when space allows — on narrow panels
              the right group wraps to its own line and left-aligns. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={executionStateTone(task.executionState)} dot>
                {titleCase(task.executionState)}
              </Badge>
              {task.kind ? <Badge tone="neutral">{task.kind}</Badge> : null}
              <Badge tone={task.ownerType === "agent" ? "blue" : "gold"}>
                {task.ownerType === "agent" ? "Task Agent" : "Owner"}
              </Badge>
              {task.agentRequestStatus === "requested" ? (
                <Badge tone="blue">
                  Queued{task.requestedHarness ? ` on ${task.requestedHarness}` : ""}
                </Badge>
              ) : null}
            </div>
            {pr || task.gitBranchName ? (
              <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
                {pr ? (
                  <>
                    <a
                      className="inline-flex items-center gap-1 text-sm font-bold text-primary no-underline hover:underline"
                      href={task.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <GitPullRequest size={14} aria-hidden />
                      {pr.label}
                      <ExternalLink size={12} aria-hidden />
                    </a>
                    {pr.status ? (
                      <Badge
                        tone={
                          pr.status === "merged"
                            ? "green"
                            : pr.status === "closed"
                              ? "red"
                              : "gold"
                        }
                      >
                        {titleCase(pr.status)}
                      </Badge>
                    ) : null}
                  </>
                ) : task.executionState === "in_review" ? (
                  <span className="text-xs text-muted-foreground">
                    PR pending
                  </span>
                ) : null}
                {task.gitBranchName ? (
                  <span
                    className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                    title={task.gitBranchName}
                  >
                    <GitBranch size={12} aria-hidden className="shrink-0" />
                    {truncateMiddle(task.gitBranchName)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {task.executionState === "in_progress" && task.ownerType === "agent" ? (
          // Live run narration sits directly under the header, above the
          // description/brief content. Only agent-owned, in-progress tasks
          // can have a streaming run; gated here (not with conditional hooks)
          // so the subscriptions unmount the moment the state flips — no
          // stale narration once the run settles.
          <TaskRunActivity taskId={task._id as string} />
        ) : null}

        {canConfirmCloseout(task) ? (
          // Post-merge close-out: gated by the parent (same hook-order
          // convention as TaskRunActivity) so the subscription unmounts the
          // moment the task leaves in_review — completion flips the task to
          // done and this section disappears with it.
          <TaskCloseout taskId={task._id as string} />
        ) : null}

        {taskApprovals.length ? (
          // Approval cards live under the narration. Precedence is prominence
          // within this stack — the card is visually hot (gold), the narration
          // quiet — not position above it (adjusts the PR #117/#118 rule).
          // A decided card plays a brief exit and disappears for good.
          <div className="grid gap-3">
            {taskApprovals.map((approval) => (
              <ApprovalCard
                key={approval._id}
                approval={approval}
                variant="panel"
                className={cn(
                  leavingIds.has(String(approval._id)) &&
                    "animate-approval-settle motion-reduce:animate-none",
                )}
              />
            ))}
          </div>
        ) : null}

        <DetailSection title="Description">
          {task.description ? (
            <ChatMarkdown variant="document" className="text-sm leading-relaxed">
              {task.description}
            </ChatMarkdown>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No description.</p>
          )}
        </DetailSection>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm">Execution brief</h3>
            {canEditBrief(task) && !editingBrief ? (
              <Button small onClick={startEditingBrief}>
                <Pencil size={13} aria-hidden /> Edit
              </Button>
            ) : null}
          </div>
          {editingBrief ? (
            <div className="grid gap-3">
              <TextArea
                value={briefDraft}
                onChange={(event) => setBriefDraft(event.target.value)}
                placeholder="What to do, where, and any context an executor needs."
                style={{ minHeight: 120 }}
              />
              <Field label="Acceptance criteria (one per line)">
                <TextArea
                  value={criteriaDraft}
                  onChange={(event) => setCriteriaDraft(event.target.value)}
                  placeholder={"Tests pass\nFeature renders in the app"}
                  style={{ minHeight: 90 }}
                />
              </Field>
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => setEditingBrief(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => void saveBrief()}
                >
                  Save brief
                </Button>
              </div>
            </div>
          ) : task.executionBrief ? (
            // Briefs are the most markdown-dense text in the app (## headers,
            // numbered plans, code spans). The document variant gives them
            // reading-surface spacing; long content still scrolls with the
            // panel body, and fenced code scrolls horizontally inside `pre`
            // without widening the narrow mobile panel.
            <ChatMarkdown variant="document" className="text-sm leading-relaxed">
              {task.executionBrief}
            </ChatMarkdown>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No brief yet.</p>
          )}
        </section>

        {!editingBrief ? (
          <DetailSection title="Acceptance criteria">
            {task.acceptanceCriteria?.length ? (
              <ul className="m-0 grid gap-1.5 pl-[18px] text-sm leading-relaxed">
                {task.acceptanceCriteria.map((criterion: string, index: number) => (
                  // Inline-only markdown: code spans, bold, and links render,
                  // but the panel's own list chrome (this ul/li) stays — the
                  // renderer never emits its own list markup here.
                  <li key={index}>
                    <ChatMarkdownInline>{criterion}</ChatMarkdownInline>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                No acceptance criteria yet.
              </p>
            )}
          </DetailSection>
        ) : null}

        {dependencies.length ? (
          <DetailSection title="Depends on">
            <div className="grid gap-1.5">
              {dependencies.map((dep) => (
                <div
                  key={dep._id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 break-words">{dep.title}</span>
                  <Badge tone={dep.done ? "green" : "gold"}>
                    {dep.done ? "done" : dep.status}
                  </Badge>
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null}

        {task.resultSummary || task.resultUrl ? (
          <DetailSection title="Result">
            {task.resultSummary ? (
              // PR URLs in summaries autolink via GFM and open in a new tab.
              <ChatMarkdown variant="document" className="mb-1.5 text-sm leading-relaxed">
                {task.resultSummary}
              </ChatMarkdown>
            ) : null}
            {task.resultUrl ? (
              <a
                className="break-all font-mono text-xs text-primary"
                href={task.resultUrl}
                target="_blank"
                rel="noreferrer"
              >
                {task.resultUrl}
              </a>
            ) : null}
          </DetailSection>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-card p-3">
        {action ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={action.kind === "mark_complete" ? onComplete : onStart}
          >
            {action.kind === "mark_complete" ? (
              <Check size={15} aria-hidden />
            ) : (
              <Play size={15} aria-hidden />
            )}
            {action.label}
          </Button>
        ) : null}
        <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
          Move to
          <Select
            className="w-auto"
            value={task.executionState}
            disabled={pending}
            onChange={(event) => void moveTo(event.target.value)}
          >
            {EXECUTION_COLUMNS.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
            {task.executionState === "cancelled" ? (
              <option value="cancelled">Abandoned</option>
            ) : null}
          </Select>
        </label>
        {canAbandon(task) ? (
          abandonConfirming ? (
            <Button
              variant="danger"
              disabled={pending}
              className="ml-auto"
              onClick={() => void abandon()}
            >
              Confirm?
            </Button>
          ) : (
            <Button
              disabled={pending}
              className="ml-auto"
              title="Abandon this task. It leaves the board but can be restored later."
              onClick={() => setAbandonConfirming(true)}
            >
              <Ban size={14} aria-hidden /> Abandon
            </Button>
          )
        ) : null}
      </footer>
    </section>
  );
}
