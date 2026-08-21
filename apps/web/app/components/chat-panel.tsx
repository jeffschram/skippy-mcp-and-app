"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { CheckCircle2, ExternalLink, FilePenLine, FilePlus2, GitPullRequest, ListChecks, MessageCircle, SendHorizontal, Sparkles, TerminalSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import { approvalMoments } from "../../lib/approvals";
import { buildChatTimeline } from "../../lib/chat-timeline";
import { summarizeChatActivity, type ChatActivityLine } from "../../lib/chat-activity";
import type { TaskMomentState } from "../../lib/task-moments";
import { ApprovalCard } from "./approval-card";

type AnyRecord = Record<string, any>;

type ChatScope =
  | { kind: "project"; projectId: string; label: string }
  | { kind: "page"; pageKey: string; label: string };

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  agenda: "Agenda",
  finances: "Finances",
  review: "Review",
  projects: "Projects",
  brain: "Brain",
  skills: "Skills",
  settings: "Settings",
};

function scopeForPathname(pathname: string): ChatScope {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch?.[1]) return { kind: "project", projectId: projectMatch[1], label: "Project" };
  const pageKey =
    pathname === "/"
      ? "home"
      : pathname.startsWith("/tasks")
        ? "agenda"
        : (pathname.split("/")[1] ?? "home");
  const known = PAGE_LABELS[pageKey] ? pageKey : "home";
  return { kind: "page", pageKey: known, label: PAGE_LABELS[known] ?? "Home" };
}

const TASK_MOMENT_META: Record<
  TaskMomentState,
  { label: string; icon: typeof Sparkles }
> = {
  created: { label: "Task added", icon: FilePlus2 },
  in_progress: { label: "In progress", icon: Sparkles },
  in_review: { label: "In review", icon: GitPullRequest },
  completed: { label: "Completed", icon: CheckCircle2 },
};

/**
 * Compact lifecycle notice, not a live view: "something is happening with
 * this task". Header + title + owner chip only, at regular chat typography —
 * no brief/description body and no run-event subscriptions (the task detail
 * panel streams live narration). An in-progress notice keeps a static pulse
 * dot as its only "running" affordance. Clicking opens the task panel when
 * the surface provides an opener.
 *
 * The in-review notice is the owner's cue to act: its centerpiece is a
 * View PR link out to GitHub (review there, then merge or comment). Anchors
 * can't nest inside buttons, so when the link is present the open-task
 * affordance shrinks to the label + title region.
 */
function TaskMoment({
  task,
  state,
  onOpen,
}: {
  task: AnyRecord;
  state: TaskMomentState;
  onOpen?: (() => void) | undefined;
}) {
  const meta = TASK_MOMENT_META[state] ?? TASK_MOMENT_META.created;
  const Icon = meta.icon;
  const prUrl =
    state === "in_review" && typeof task.prUrl === "string" && task.prUrl
      ? task.prUrl
      : undefined;
  const header = (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-primary">
      <Icon size={14} aria-hidden />
      {meta.label}
      {state === "in_progress" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      ) : null}
    </span>
  );
  const title = (
    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
  );
  const ownerChip = (
    <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] text-primary">
      {task.ownerType === "agent" ? "Agent" : "Owner"}
    </span>
  );
  const surface =
    "my-1 flex w-full items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 text-left";
  if (prUrl) {
    return (
      <article className={surface}>
        {onOpen ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
            onClick={onOpen}
            title="Open task details"
          >
            {header}
            {title}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            {header}
            {title}
          </span>
        )}
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline"
          title="Review this pull request on GitHub"
        >
          View PR{typeof task.prNumber === "number" ? ` #${task.prNumber}` : ""}
          <ExternalLink size={12} aria-hidden />
        </a>
        {ownerChip}
      </article>
    );
  }
  const body = (
    <>
      {header}
      {title}
      {ownerChip}
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        className={cn(surface, "cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/[0.08]")}
        onClick={onOpen}
        title="Open task details"
      >
        {body}
      </button>
    );
  }
  return <article className={surface}>{body}</article>;
}

function activityLineIcon(line: ChatActivityLine) {
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
 * In-flight reply: the harness's latest narration plus a compact tail of what
 * it is actually doing (commands, edits, plan progress). Falls back to the
 * classic "Thinking…" pulse until the first events arrive.
 */
function LiveActivity({ events }: { events: AnyRecord[] }) {
  const activity = useMemo(() => summarizeChatActivity(events), [events]);
  const idle = !activity.narration && !activity.lines.length && !activity.plan;
  if (idle) {
    return <div className="max-w-[88%] self-start text-sm text-muted-foreground animate-pulse">Thinking…</div>;
  }
  return (
    <div className="grid max-w-[92%] gap-2 self-start">
      {activity.narration ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{activity.narration}</div>
      ) : null}
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
            {activityLineIcon(line)}
            <span className="min-w-0 break-words">{line.kind === "command" ? `$ ${line.text}` : line.text}</span>
          </p>
        ))}
        <p className="m-0 text-xs font-bold text-primary animate-pulse">Working…</p>
      </div>
    </div>
  );
}

function ChatSurface({
  scope,
  className,
  header,
  taskMoments,
  runApprovals,
  onOpenTask,
}: {
  scope: ChatScope;
  className?: string | undefined;
  header?: ReactNode | undefined;
  taskMoments?: AnyRecord[] | undefined;
  /** Run approvals for the project scope (approvalsForProjectForViewer). */
  runApprovals?: AnyRecord[] | undefined;
  /** Opens the task detail panel for full approval detail. */
  onOpenTask?: ((taskId: string) => void) | undefined;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pickedHarness, setPickedHarness] = useState<"claude" | "codex">("claude");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const queryArgs = scope.kind === "project" ? { projectId: scope.projectId as any } : { pageKey: scope.pageKey };
  const data = useQuery(api.chats.chatForScopeForViewer, isAuthenticated ? queryArgs : "skip") as AnyRecord | undefined;
  const sendMessage = useMutation(api.chats.sendChatMessageForViewer);
  const messages: AnyRecord[] = data?.messages ?? [];
  const pendingApprovals: AnyRecord[] = data?.pendingApprovals ?? [];
  const activeTurnEvents: AnyRecord[] = data?.activeTurnEvents ?? [];
  const boundHarness: string | undefined = data?.chat?.harness;
  const timelineItems = useMemo(
    () => buildChatTimeline(messages, taskMoments, approvalMoments(runApprovals ?? [])),
    [messages, taskMoments, runApprovals],
  );
  const lastTimelineItem = timelineItems[timelineItems.length - 1];

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [
    timelineItems.length,
    lastTimelineItem?.key,
    lastTimelineItem?.kind === "message"
      ? lastTimelineItem.message.status
      : lastTimelineItem?.moment.state,
    // Keep the view pinned to the bottom while live activity streams in.
    activeTurnEvents.length,
    activeTurnEvents[activeTurnEvents.length - 1]?.seq,
  ]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendMessage({ ...queryArgs, content, harness: boundHarness ?? pickedHarness } as any);
    } catch (error) {
      setDraft(content);
      console.error("chat send failed", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden bg-background", className)} aria-label="Skippy chat">
      {header ?? (
        <header className="flex min-h-14 items-center gap-2 border-b px-4">
          <MessageCircle size={17} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold">Project chat</p>
            <p className="m-0 truncate text-xs text-muted-foreground">
              {data?.chat?.title ?? scope.label}{boundHarness ? ` · ${boundHarness}` : ""}
            </p>
          </div>
          {!boundHarness ? (
            <select
              className="rounded-lg border bg-card px-2 py-1.5 text-xs"
              value={pickedHarness}
              onChange={(event) => setPickedHarness(event.target.value as "claude" | "codex")}
              aria-label="Assistant"
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          ) : null}
        </header>
      )}

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 desk:px-6" ref={messagesRef}>
        {timelineItems.length === 0 ? (
          <div className="mx-auto my-auto max-w-md text-center">
            <MessageCircle className="mx-auto mb-3 text-primary" size={24} aria-hidden />
            <p className="mb-1 font-bold">Talk through this project</p>
            <p className="m-0 text-sm text-muted-foreground">
              Ask what comes next, update project details, or discuss work already in progress.
            </p>
          </div>
        ) : (
          timelineItems.map((item) => {
            if (item.kind === "task") {
              const momentTask = item.moment.task;
              return (
                <TaskMoment
                  key={item.key}
                  task={momentTask}
                  state={item.moment.state}
                  onOpen={
                    onOpenTask && momentTask?._id
                      ? () => onOpenTask(momentTask._id)
                      : undefined
                  }
                />
              );
            }
            if (item.kind === "approval") {
              // Compact actionable notice: chat notifies, the panel holds
              // the detail — but a parked run needs the owner even while
              // they're chatting, so the decision buttons live inline.
              const approval = item.moment.approval;
              return (
                <ApprovalCard
                  key={item.key}
                  approval={approval}
                  variant="chat"
                  className="my-1"
                  onOpenTask={
                    onOpenTask && approval.taskId
                      ? () => onOpenTask(approval.taskId)
                      : undefined
                  }
                />
              );
            }
            const message = item.message;
            if (message.role === "assistant" && message.status === "pending") {
              return <LiveActivity key={item.key} events={activeTurnEvents} />;
            }
            if (message.role === "assistant" && message.status === "error") {
              return <div key={item.key} className="max-w-[88%] self-start text-sm text-destructive">{message.error ?? "Reply failed."}</div>;
            }
            return message.role === "user" ? (
              <div key={item.key} className="max-w-[82%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
                {message.content}
              </div>
            ) : (
              <div key={item.key} className="max-w-[92%] self-start whitespace-pre-wrap text-sm leading-relaxed">
                {message.content}
              </div>
            );
          })
        )}
      </div>

      {pendingApprovals.length ? (
        // Conversational (chat-turn) approvals: same compact card and
        // decision path as run approvals, docked above the composer because
        // they gate the in-flight reply rather than a project task.
        <div className="grid gap-2 border-t bg-secondary px-4 py-3">
          {pendingApprovals.map((approval) => (
            <ApprovalCard key={approval._id} approval={approval} variant="chat" />
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t bg-card p-3 desk:p-4">
        <textarea
          className="min-h-11 max-h-32 flex-1 resize-none rounded-xl border bg-background px-3 py-2.5 text-sm"
          value={draft}
          placeholder={scope.kind === "project" ? "Message about this project…" : `Message ${scope.label}…`}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50" disabled={!draft.trim() || sending} onClick={() => void send()} aria-label="Send message">
          <SendHorizontal size={17} aria-hidden />
        </button>
      </div>
    </section>
  );
}

export function ProjectChatWorkspace({
  projectId,
  taskMoments,
  runApprovals,
  onOpenTask,
  className,
}: {
  projectId: string;
  taskMoments?: AnyRecord[] | undefined;
  runApprovals?: AnyRecord[] | undefined;
  onOpenTask?: ((taskId: string) => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <ChatSurface
      scope={{ kind: "project", projectId, label: "Project" }}
      taskMoments={taskMoments}
      runApprovals={runApprovals}
      onOpenTask={onOpenTask}
      className={className}
    />
  );
}

export function ChatPanel() {
  const pathname = usePathname() ?? "/";
  const { isAuthenticated } = useConvexAuth();
  const scope = useMemo(() => scopeForPathname(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  if (!isAuthenticated || scope.kind === "project") return null;
  if (!open) {
    return (
      <button type="button" className="fixed bottom-3.5 right-3.5 z-[60] inline-flex items-center gap-2 rounded-full border bg-secondary px-3.5 py-2.5 font-bold shadow-md" onClick={() => setOpen(true)} aria-label="Open chat">
        <MessageCircle size={17} aria-hidden /> Chat
      </button>
    );
  }
  return (
    <ChatSurface
      scope={scope}
      className="fixed bottom-0 right-0 z-[70] h-[calc(100dvh-110px)] w-screen rounded-t-2xl border bg-card shadow-md desk:bottom-[18px] desk:right-[18px] desk:h-[min(560px,calc(100vh-90px))] desk:w-[400px] desk:rounded-2xl"
      header={
        <header className="flex min-h-14 items-center gap-2 border-b bg-secondary px-4">
          <MessageCircle size={16} aria-hidden />
          <span className="flex-1 text-sm font-bold">Chat</span>
          <button type="button" className="grid size-8 place-items-center rounded-lg hover:bg-border" onClick={() => setOpen(false)} aria-label="Close chat"><X size={16} aria-hidden /></button>
        </header>
      }
    />
  );
}
