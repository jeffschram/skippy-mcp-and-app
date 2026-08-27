"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowDown, CheckCircle2, ExternalLink, File as FileIcon, FilePenLine, FilePlus2, GitPullRequest, ListChecks, MessageCircle, Paperclip, SendHorizontal, Sparkles, TerminalSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "../../lib/chat-markdown";
import { isPinnedToBottom, shouldShowJumpToBottom } from "../../lib/chat-scroll";
import { api } from "../../lib/skippy-api";
import { approvalMoments } from "../../lib/approvals";
import { buildChatTimeline } from "../../lib/chat-timeline";
import { summarizeChatActivity, type ChatActivityLine } from "../../lib/chat-activity";
import type { TaskMomentState } from "../../lib/task-moments";
import { ApprovalCard } from "./approval-card";
import { Avatar, type AvatarStateName } from "./avatar";
import { useSettlingApprovals } from "./use-settling-approvals";
import { Spinner } from "./ui";
import { useToast } from "./widgets";
import { useProjectFileUploader, type UploadedProjectFile } from "../hubs/project-library";
import {
  PROJECT_FILE_ACCEPT,
  checkProjectFile,
  formatFileSize,
  iconKindForMimeType,
} from "../hubs/project-library-helpers";

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
        <ChatMarkdown className="text-sm leading-relaxed text-muted-foreground">{activity.narration}</ChatMarkdown>
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

/** Non-image attachment chip: icon + name + size, downloadable while the URL lives. */
function AttachmentChip({ attachment }: { attachment: AnyRecord }) {
  const body = (
    <>
      <FileIcon size={14} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-semibold">{attachment.fileName}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
    </>
  );
  const chipClass =
    "flex max-w-60 items-center gap-1.5 rounded-lg border bg-secondary px-2.5 py-1.5 text-xs text-foreground";
  if (attachment.url) {
    return (
      <a className={cn(chipClass, "no-underline hover:border-primary")} href={attachment.url} target="_blank" rel="noreferrer" title={`Download ${attachment.fileName}`}>
        {body}
      </a>
    );
  }
  return <span className={chipClass}>{body}</span>;
}

/**
 * The composer owns its draft locally so keystrokes re-render only this small
 * region — not the whole ChatSurface (timeline rebuild + ChatMarkdown for
 * every message), which caused visible typing lag on long transcripts. The
 * parent only learns about the text on send; `onSend` resolves false when the
 * message didn't go through so the draft can be restored.
 *
 * Layout follows the Codex/ChatGPT convention: one rounded container that
 * reads as "the text box", with a borderless auto-growing textarea on top and
 * a pinned control row below (avatar on the left; harness, attach, and send
 * on the right). The textarea expands with content while the controls stay put.
 */
function ChatComposer({
  placeholder,
  avatarState,
  canAttach,
  hasAttachments,
  busy,
  harness,
  harnessBound,
  onChooseHarness,
  onSend,
  onAddFiles,
  onTypingChange,
}: {
  placeholder: string;
  avatarState: AvatarStateName;
  canAttach: boolean;
  hasAttachments: boolean;
  busy: boolean;
  /** Currently effective harness (bound conversation harness or the picked default). */
  harness: "claude" | "codex";
  /** Whether the conversation is already bound — switching then starts a new chat. */
  harnessBound: boolean;
  onChooseHarness: (next: "claude" | "codex") => void;
  onSend: (content: string) => Promise<boolean>;
  onAddFiles: (files: File[]) => void;
  /** Fires only when the draft crosses between empty and non-empty. */
  onTypingChange: (typing: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const typingRef = useRef(false);

  const updateDraft = (nextDraft: string) => {
    setDraft(nextDraft);
    const typing = Boolean(nextDraft.trim());
    if (typing !== typingRef.current) {
      typingRef.current = typing;
      onTypingChange(typing);
    }
  };

  const send = async () => {
    const content = draft.trim();
    if ((!content && !hasAttachments) || busy) return;
    updateDraft("");
    const ok = await onSend(content);
    if (!ok) updateDraft(content);
  };

  return (
    <div className="p-3 pb-6 desk:p-3 desk:px-[4vw] desk:pb-[2vw] desk:pt-[1vw]">
      <div className="rounded-2xl border bg-card transition-colors focus-within:border-primary/60">
        <textarea
          className="max-h-40 min-h-11 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[16px] outline-none"
          style={{ fieldSizing: "content" }}
          value={draft}
          placeholder={placeholder}
          rows={1}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          onPaste={(event) => {
            if (!canAttach) return;
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length) {
              event.preventDefault();
              onAddFiles(files);
            }
          }}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <Avatar state={avatarState} className="shrink-0 select-none px-1 font-mono text-sm font-semibold text-foreground" />
          <div className="flex-1" />
          <select
            className="rounded-lg border-0 bg-transparent px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            value={harness}
            onChange={(event) => onChooseHarness(event.target.value as "claude" | "codex")}
            aria-label="Assistant"
            title={harnessBound ? "Changing assistant starts a new conversation" : "Choose assistant"}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          {canAttach ? (
            <>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept={PROJECT_FILE_ACCEPT}
                style={{ display: "none" }}
                onChange={(event) => {
                  onAddFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => attachInputRef.current?.click()}
                aria-label="Attach files"
                title="Attach files"
              >
                <Paperclip size={17} aria-hidden />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            disabled={(!draft.trim() && !hasAttachments) || busy}
            onClick={() => void send()}
            aria-label="Send message"
          >
            <SendHorizontal size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Message attachments: images render inline, other files as name/size chips. */
function MessageAttachments({ attachments }: { attachments: AnyRecord[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {attachments.map((attachment, index) => {
        const key = `${attachment.fileName}:${index}`;
        if (iconKindForMimeType(attachment.mimeType) === "image" && attachment.url) {
          return (
            <a key={key} href={attachment.url} target="_blank" rel="noreferrer" title={attachment.fileName}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral storage URL, not optimizable */}
              <img
                src={attachment.url}
                alt={attachment.fileName}
                loading="lazy"
                className="max-h-48 max-w-full rounded-xl border object-cover"
              />
            </a>
          );
        }
        return <AttachmentChip key={key} attachment={attachment} />;
      })}
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
  const [sending, setSending] = useState(false);
  const [pickedHarness, setPickedHarness] = useState<"claude" | "codex">("claude");
  const harnessWasPicked = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const queryArgs = scope.kind === "project" ? { projectId: scope.projectId as any } : { pageKey: scope.pageKey };
  const data = useQuery(api.chats.chatForScopeForViewer, isAuthenticated ? queryArgs : "skip") as AnyRecord | undefined;
  const executionConfig = useQuery(
    api.agentWorkbench.projectExecutionConfigForViewer,
    isAuthenticated && scope.kind === "project" ? { projectId: scope.projectId as any } : "skip",
  ) as AnyRecord | null | undefined;
  const sendMessage = useMutation(api.chats.sendChatMessageForViewer);
  const startNewChat = useMutation(api.chats.startNewChatForViewer);

  // A project's Settings mapping is the initial choice, but remains
  // overridable until the first message permanently binds the conversation.
  useEffect(() => {
    if (!harnessWasPicked.current && executionConfig?.preferredHarness) {
      setPickedHarness(executionConfig.preferredHarness);
    }
  }, [executionConfig?.preferredHarness]);

  // Attachments ride the project library (upload → register → reference), so
  // the affordance exists for project chats only in v1 — page chats hide it.
  const canAttach = scope.kind === "project";
  const toast = useToast();
  const { uploadFiles } = useProjectFileUploader(scope.kind === "project" ? scope.projectId : "");
  const [attachments, setAttachments] = useState<UploadedProjectFile[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!canAttach || !files.length) return;
    // Friendly pre-check: the library's shared size/type limits, surfaced as
    // toasts (the chat doesn't render the library's inline status list).
    const accepted: File[] = [];
    for (const file of files) {
      const check = checkProjectFile({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
      if (!check.ok) toast(`Can't attach ${file.name || "this file"}: ${check.reason}`, "error");
      else accepted.push(file);
    }
    if (!accepted.length) return;
    setUploadingCount((count) => count + accepted.length);
    try {
      const { uploaded } = await uploadFiles(accepted, undefined, { note: "chat attachment" });
      if (uploaded.length) setAttachments((current) => [...current, ...uploaded]);
    } finally {
      setUploadingCount((count) => count - accepted.length);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    if (!canAttach || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    setDragOver(true);
  };
  const handleDrop = (event: DragEvent) => {
    if (!canAttach) return;
    event.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(event.dataTransfer?.files ?? []));
  };
  const messages: AnyRecord[] = data?.messages ?? [];
  const pendingApprovals: AnyRecord[] = data?.pendingApprovals ?? [];
  const activeTurnEvents: AnyRecord[] = data?.activeTurnEvents ?? [];
  const boundHarness: string | undefined = data?.chat?.harness;
  const [isTyping, setIsTyping] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [avatarMoment, setAvatarMoment] = useState<AvatarStateName | null>(null);
  const avatarMomentTimerRef = useRef<number | null>(null);
  const showAvatarMoment = useCallback((state: AvatarStateName, durationMs: number) => {
    if (avatarMomentTimerRef.current !== null) window.clearTimeout(avatarMomentTimerRef.current);
    setAvatarMoment(state);
    avatarMomentTimerRef.current = window.setTimeout(() => {
      setAvatarMoment(null);
      avatarMomentTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (avatarMomentTimerRef.current !== null) window.clearTimeout(avatarMomentTimerRef.current);
    };
  }, []);

  const pendingAssistantMessage = [...messages]
    .reverse()
    .find((message: AnyRecord) => message.role === "assistant" && message.status === "pending");
  const latestCompletedAssistantMessage = [...messages]
    .reverse()
    .find((message: AnyRecord) => message.role === "assistant" && message.status === "complete");
  const latestTurnEvent = activeTurnEvents[activeTurnEvents.length - 1];
  const latestErrorEventKey =
    latestTurnEvent?.type === "error"
      ? `${String(latestTurnEvent._id ?? "event")}:${String(latestTurnEvent.seq ?? "")}`
      : null;
  const latestNotableTaskMoment = [...(taskMoments ?? [])]
    .filter((moment) => moment.state === "in_review" || moment.state === "completed")
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))[0];
  const latestAssistantKey = latestCompletedAssistantMessage?._id
    ? String(latestCompletedAssistantMessage._id)
    : null;
  const latestTaskMomentKey = latestNotableTaskMoment?.key
    ? String(latestNotableTaskMoment.key)
    : null;
  const avatarSourceKey = String(
    data?.chat?._id ?? (scope.kind === "project" ? `project:${scope.projectId}` : `page:${scope.pageKey}`),
  );
  const avatarBaselineSourceRef = useRef<string | null>(null);
  const seenAssistantKeyRef = useRef<string | null>(null);
  const seenTaskMomentKeyRef = useRef<string | null>(null);
  const seenErrorEventRef = useRef<string | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    if (avatarBaselineSourceRef.current !== avatarSourceKey) {
      avatarBaselineSourceRef.current = avatarSourceKey;
      seenAssistantKeyRef.current = latestAssistantKey;
      seenTaskMomentKeyRef.current = latestTaskMomentKey;
      seenErrorEventRef.current = latestErrorEventKey;
      return;
    }

    const errorChanged = Boolean(latestErrorEventKey && latestErrorEventKey !== seenErrorEventRef.current);
    const taskChanged = Boolean(latestTaskMomentKey && latestTaskMomentKey !== seenTaskMomentKeyRef.current);
    const assistantChanged = Boolean(latestAssistantKey && latestAssistantKey !== seenAssistantKeyRef.current);

    seenAssistantKeyRef.current = latestAssistantKey;
    seenTaskMomentKeyRef.current = latestTaskMomentKey;
    seenErrorEventRef.current = latestErrorEventKey;

    if (errorChanged) showAvatarMoment("disagree", 1500);
    else if (taskChanged && latestNotableTaskMoment?.state === "completed") showAvatarMoment("celebrate", 2000);
    else if (taskChanged && latestNotableTaskMoment?.state === "in_review") showAvatarMoment("proud", 1800);
    else if (assistantChanged) showAvatarMoment("wink", 1000);
  }, [
    data,
    avatarSourceKey,
    latestAssistantKey,
    latestErrorEventKey,
    latestNotableTaskMoment?.state,
    latestTaskMomentKey,
    showAvatarMoment,
  ]);

  const latestMessage = messages[messages.length - 1];
  const idleActivityKey = `${String(latestMessage?._id ?? "")}:${String(latestMessage?.status ?? "")}:${String(latestTurnEvent?.seq ?? "")}`;
  const hasPendingApproval =
    pendingApprovals.length > 0 || (runApprovals ?? []).some((approval) => approval.status === "pending");

  useEffect(() => {
    setIsSleeping(false);
    if (pendingAssistantMessage || sending || isTyping || hasPendingApproval || avatarMoment) return;
    const timeoutId = window.setTimeout(() => setIsSleeping(true), 30_000);
    return () => window.clearTimeout(timeoutId);
  }, [avatarMoment, hasPendingApproval, idleActivityKey, isTyping, pendingAssistantMessage, sending]);

  const avatarState: AvatarStateName = avatarMoment
    ? avatarMoment
    : hasPendingApproval
      ? "surprised"
      : pendingAssistantMessage || sending
        ? latestTurnEvent?.type === "assistant_message"
          ? "talking"
          : "searching"
        : isTyping
          ? "smile"
          : isSleeping
            ? "sleeping"
            : "default";

  const chooseHarness = async (next: "claude" | "codex") => {
    harnessWasPicked.current = true;
    if (!boundHarness) {
      setPickedHarness(next);
      return;
    }
    if (next === boundHarness) return;
    const label = next === "codex" ? "Codex" : "Claude";
    if (!window.confirm(`Start a new ${label} conversation? Your current transcript will be preserved.`)) return;
    try {
      await startNewChat({ ...queryArgs, harness: next } as any);
      setPickedHarness(next);
      toast(`New ${label} conversation started.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not switch assistants", "error");
    }
  };
  // Settled run approvals leave the transcript (after a brief exit): the
  // notice is not the durable record of the decision — the run/task activity
  // history is. Filtering happens here at render; the query keeps returning
  // settled approvals.
  const { approvals: liveRunApprovals, leavingIds: leavingApprovalIds } =
    useSettlingApprovals(runApprovals ?? []);
  const timelineItems = useMemo(
    () => buildChatTimeline(messages, taskMoments, approvalMoments(liveRunApprovals)),
    [messages, taskMoments, liveRunApprovals],
  );
  const lastTimelineItem = timelineItems[timelineItems.length - 1];

  // Scroll-follow state. `pinnedRef` mirrors whether the user is at/near the
  // bottom: while pinned we auto-follow new content; once they scroll up to
  // read history, incoming messages must not yank the position — the floating
  // arrow is the way back. A ref (not state) because scroll events fire fast
  // and the effects below need the freshest value without re-rendering.
  const pinnedRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const chatKey = scope.kind === "project" ? `project:${scope.projectId}` : `page:${scope.pageKey}`;

  const scrollToBottom = () => {
    const el = messagesRef.current;
    // Direct scrollTop assignment is instant (no smooth animation), so a
    // fresh chat never visibly jumps from top to bottom.
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleTranscriptScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    const metrics = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    pinnedRef.current = isPinnedToBottom(metrics);
    setShowJumpToBottom(shouldShowJumpToBottom(metrics));
  };

  const jumpToBottom = () => {
    pinnedRef.current = true;
    setShowJumpToBottom(false);
    scrollToBottom();
  };

  // Switching chats (the floating panel keeps one ChatSurface instance across
  // routes): re-pin and land at the latest message before paint.
  useLayoutEffect(() => {
    pinnedRef.current = true;
    setShowJumpToBottom(false);
    scrollToBottom();
  }, [chatKey]);

  // Follow new content only while pinned. useLayoutEffect runs after the
  // markdown renderer has laid out its variable-height messages but before
  // paint, so the initial load lands directly on the latest message.
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
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

  // Called by the composer (which owns the draft text). Returns whether the
  // message went through so the composer knows to restore the draft on failure.
  const send = async (content: string) => {
    if ((!content && !attachments.length) || sending || uploadingCount > 0) return false;
    setSending(true);
    // Sending is an explicit return to the conversation: re-pin so the sent
    // message (and the reply) scroll into view even if they were reading history.
    pinnedRef.current = true;
    setShowJumpToBottom(false);
    const sentAttachments = attachments;
    setAttachments([]);
    try {
      await sendMessage({
        ...queryArgs,
        content,
        harness: boundHarness ?? pickedHarness,
        ...(sentAttachments.length ? { attachments: sentAttachments.map(({ fileId }) => ({ fileId })) } : {}),
      } as any);
      return true;
    } catch (error) {
      setAttachments(sentAttachments);
      showAvatarMoment("disagree", 1500);
      console.error("chat send failed", error);
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className={cn("relative flex min-h-0 flex-col overflow-hidden bg-background", className)}
      aria-label="Skippy chat"
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] border-2 border-dashed border-primary bg-primary/10">
          <p className="m-0 flex items-center gap-2 text-sm font-bold text-primary">
            <Paperclip size={16} aria-hidden /> Drop files to attach
          </p>
        </div>
      ) : null}
      {/* Project chat renders headerless — the transcript starts at the top
          and the harness lives in the composer. The floating page panel
          passes its own header (it needs the close affordance). */}
      {header}

      <div className="relative flex min-h-0 flex-1">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 desk:px-[4vw]" ref={messagesRef} onScroll={handleTranscriptScroll}>
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
              // Once decided, the notice fades out of the transcript.
              const approval = item.moment.approval;
              return (
                <ApprovalCard
                  key={item.key}
                  approval={approval}
                  variant="chat"
                  className={cn(
                    "my-1",
                    leavingApprovalIds.has(String(approval._id)) &&
                      "animate-approval-settle motion-reduce:animate-none",
                  )}
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
              <div key={item.key} className="flex max-w-[82%] flex-col items-end gap-1.5 self-end">
                {message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : null}
                {message.content ? (
                  <div className="rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground [&_code]:bg-primary-foreground/15 [&_pre]:border-primary-foreground/20 [&_pre]:bg-primary-foreground/15">
                    <ChatMarkdown>{message.content}</ChatMarkdown>
                  </div>
                ) : null}
              </div>
            ) : (
              <ChatMarkdown key={item.key} className="max-w-[92%] self-start text-sm leading-relaxed">
                {message.content ?? ""}
              </ChatMarkdown>
            );
          })
        )}
      </div>
      {showJumpToBottom ? (
        // Floating way back to the latest message, shown only once the user
        // has scrolled up ~a viewport. Sits above the composer, outside the
        // scroll container so it doesn't ride along with the transcript.
        <button
          type="button"
          className="absolute bottom-3 right-4 z-10 grid size-9 place-items-center rounded-full border bg-secondary text-muted-foreground shadow-md transition-colors hover:text-foreground"
          onClick={jumpToBottom}
          aria-label="Jump to latest message"
          title="Jump to latest message"
        >
          <ArrowDown size={16} aria-hidden />
        </button>
      ) : null}
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

      {canAttach && (attachments.length > 0 || uploadingCount > 0) ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-card p-3 desk:px-4">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.fileId}:${index}`}
              className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-secondary px-2.5 py-1.5 text-xs"
            >
              <FileIcon size={14} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-semibold">{attachment.fileName}</span>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
              <button
                type="button"
                className="grid shrink-0 place-items-center rounded hover:bg-border"
                aria-label={`Remove ${attachment.fileName}`}
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {uploadingCount > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner /> Uploading…
            </span>
          ) : null}
        </div>
      ) : null}

      <ChatComposer
        placeholder={scope.kind === "project" ? "Message about this project…" : `Message ${scope.label}…`}
        avatarState={avatarState}
        canAttach={canAttach}
        hasAttachments={attachments.length > 0}
        busy={sending || uploadingCount > 0}
        harness={(boundHarness as "claude" | "codex" | undefined) ?? pickedHarness}
        harnessBound={Boolean(boundHarness)}
        onChooseHarness={(next) => void chooseHarness(next)}
        onSend={send}
        onAddFiles={(files) => void addFiles(files)}
        onTypingChange={setIsTyping}
      />
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
      className="fixed bottom-0 right-0 z-[70] h-[calc(100dvh-110px)] w-screen rounded-t-2xl border bg-card shadow-md desk:bottom-[18px] desk:right-[18px] desk:h-[min(1500px,calc(100vh-90px))] desk:w-[800px] desk:rounded-2xl"
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
