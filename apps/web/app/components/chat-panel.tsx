"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { CheckCircle2, MessageCircle, SendHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";

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

function TaskMoment({
  task,
  state,
}: {
  task: AnyRecord;
  state: "in_progress" | "completed";
}) {
  const done = state === "completed";
  return (
    <article className="my-2 w-full rounded-xl border border-primary/35 bg-primary/[0.06] p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-primary">
        {done ? <CheckCircle2 size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
        {done ? "Task completed" : "In progress"}
        {task.ownerType === "agent" ? (
          <span className="ml-auto rounded-full border border-primary/30 px-2 py-0.5 normal-case tracking-normal">Agent</span>
        ) : null}
      </div>
      <h3 className="m-0 text-lg font-semibold">{task.title}</h3>
      {task.executionBrief || task.description ? (
        <p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {task.executionBrief || task.description}
        </p>
      ) : null}
    </article>
  );
}

function ChatSurface({
  scope,
  className,
  header,
  taskMoments,
}: {
  scope: ChatScope;
  className?: string | undefined;
  header?: ReactNode | undefined;
  taskMoments?: AnyRecord[] | undefined;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pickedHarness, setPickedHarness] = useState<"claude" | "codex">("claude");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const queryArgs = scope.kind === "project" ? { projectId: scope.projectId as any } : { pageKey: scope.pageKey };
  const data = useQuery(api.chats.chatForScopeForViewer, isAuthenticated ? queryArgs : "skip") as AnyRecord | undefined;
  const sendMessage = useMutation(api.chats.sendChatMessageForViewer);
  const decideApproval = useMutation(api.agentWorkbench.decideApprovalForViewer);
  const messages: AnyRecord[] = data?.messages ?? [];
  const pendingApprovals: AnyRecord[] = data?.pendingApprovals ?? [];
  const boundHarness: string | undefined = data?.chat?.harness;
  const timelineItems = useMemo(
    () =>
      [
        ...messages.map((message) => ({
          kind: "message" as const,
          key: `message:${message._id}`,
          timestamp: Number(message.createdAt ?? 0),
          tieBreak: 1,
          message,
        })),
        ...(taskMoments ?? []).map((moment) => ({
          kind: "task" as const,
          key: moment.key as string,
          timestamp: Number(moment.timestamp ?? 0),
          tieBreak: 0,
          moment,
        })),
      ].sort(
        (a, b) =>
          a.timestamp - b.timestamp ||
          a.tieBreak - b.tieBreak ||
          a.key.localeCompare(b.key),
      ),
    [messages, taskMoments],
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
              return (
                <TaskMoment
                  key={item.key}
                  task={item.moment.task}
                  state={item.moment.state}
                />
              );
            }
            const message = item.message;
            if (message.role === "assistant" && message.status === "pending") {
              return (
                <div key={item.key} className="max-w-[88%] self-start text-sm text-muted-foreground animate-pulse">
                  Thinking…
                </div>
              );
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
        <div className="grid gap-2 border-t bg-secondary px-4 py-3">
          {pendingApprovals.map((approval) => (
            <div key={approval._id} className="grid gap-2 rounded-xl border border-gold p-3">
              <p className="m-0 text-sm font-bold">{approval.title}</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" onClick={() => void decideApproval({ approvalId: approval._id, decision: "accepted" } as any)}>Approve</button>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-bold" onClick={() => void decideApproval({ approvalId: approval._id, decision: "declined" } as any)}>Decline</button>
              </div>
            </div>
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
  className,
}: {
  projectId: string;
  taskMoments?: AnyRecord[] | undefined;
  className?: string | undefined;
}) {
  return (
    <ChatSurface
      scope={{ kind: "project", projectId, label: "Project" }}
      taskMoments={taskMoments}
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
