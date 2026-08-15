"use client";

/**
 * Page-aware chat panel, mounted on every page via AppShell.
 *
 * The scope follows the route: project pages bind to that project's General
 * chat; every other page binds to a per-page chat (home, agenda, finances, ...).
 * Replies are executed by the Mac mini runner's LOCAL harness (Claude Code or
 * Codex CLI under the user's own subscription auth — never a metered API
 * call), with the same capabilities as a terminal session. Gated actions
 * surface here as inline approval cards. Hidden behind a floating toggle; on
 * small screens the panel opens as a near-fullscreen sheet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { MessageCircle, SendHorizontal, X } from "lucide-react";
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

/** Route → chat scope. Project detail pages get the project's General chat. */
function scopeForPathname(pathname: string): ChatScope {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch?.[1]) {
    return { kind: "project", projectId: projectMatch[1], label: "Project" };
  }
  const pageKey =
    pathname === "/"
      ? "home"
      : pathname.startsWith("/tasks")
        ? "agenda"
        : (pathname.split("/")[1] ?? "home");
  const known = PAGE_LABELS[pageKey] ? pageKey : "home";
  return { kind: "page", pageKey: known, label: PAGE_LABELS[known] ?? "Home" };
}

const bubbleClass =
  "max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-[11px] py-2 text-[13.5px] leading-[1.45]";
const bubbleAssistantClass = "self-start rounded-bl-[4px] border bg-secondary";
const bubbleUserClass = "self-end rounded-br-[4px] bg-primary text-primary-foreground";
const bubbleErrorClass = "self-start border border-destructive bg-transparent text-destructive";

export function ChatPanel() {
  const pathname = usePathname() ?? "/";
  const { isAuthenticated } = useConvexAuth();
  const scope = useMemo(() => scopeForPathname(pathname), [pathname]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pickedHarness, setPickedHarness] = useState<"claude" | "codex">("claude");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const queryArgs =
    scope.kind === "project" ? { projectId: scope.projectId as any } : { pageKey: scope.pageKey };
  const data = useQuery(api.chats.chatForScopeForViewer, isAuthenticated && open ? queryArgs : "skip") as
    | AnyRecord
    | undefined;
  const sendMessage = useMutation(api.chats.sendChatMessageForViewer);
  const decideApproval = useMutation(api.agentWorkbench.decideApprovalForViewer);

  const messages: AnyRecord[] = data?.messages ?? [];
  const pendingApprovals: AnyRecord[] = data?.pendingApprovals ?? [];
  // The chat binds to one harness on its first message; after that it's fixed.
  const boundHarness: string | undefined = data?.chat?.harness;

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.status, open]);

  if (!isAuthenticated) return null;

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendMessage({ ...queryArgs, content, harness: boundHarness ?? pickedHarness } as any);
    } catch (error) {
      // Restore the draft so a transient failure doesn't eat the message.
      setDraft(content);
      console.error("chat send failed", error);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="fixed bottom-3.5 right-3.5 z-[60] inline-flex cursor-pointer items-center gap-2 rounded-full border bg-secondary px-3.5 py-2.5 font-bold shadow-md desk:bottom-[18px] desk:right-[18px]"
        onClick={() => setOpen(true)}
        aria-label="Open chat"
      >
        <MessageCircle size={17} aria-hidden />
        Chat
      </button>
    );
  }

  const contextLine =
    scope.kind === "project" ? (data?.chat?.title ?? "Project chat") : `${scope.label} · page chat`;

  return (
    <section
      className="fixed bottom-0 right-0 z-[70] flex h-[calc(100dvh-110px)] w-screen flex-col overflow-hidden rounded-t-[14px] border border-x-0 border-b-0 bg-card shadow-md desk:bottom-[18px] desk:right-[18px] desk:h-[min(560px,calc(100vh-90px))] desk:w-[min(400px,calc(100vw-36px))] desk:rounded-[14px] desk:border"
      aria-label="Skippy chat"
    >
      <header className="flex items-center gap-2 border-b bg-secondary px-3 py-2.5">
        <MessageCircle size={16} aria-hidden />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold">
          Chat
          <span className="block text-[11px] font-normal opacity-70">
            {contextLine}
            {boundHarness ? ` · ${boundHarness}` : ""}
          </span>
        </span>
        {!boundHarness ? (
          <select
            className="rounded-[7px] border bg-card px-1.5 py-1 text-xs"
            value={pickedHarness}
            onChange={(event) => setPickedHarness(event.target.value as "claude" | "codex")}
            aria-label="Harness for this chat"
            title="Which local harness answers this chat (fixed after the first message)"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        ) : null}
        <button
          type="button"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[7px] border-0 bg-transparent hover:bg-border"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3" ref={messagesRef}>
        {messages.length === 0 ? (
          <p className="m-auto px-6 text-center text-[13px] opacity-65">
            {scope.kind === "project"
              ? "Chat with your local harness about this project — it runs in the project checkout with your normal tools."
              : `Chat with your local harness from the ${scope.label} page — same capabilities as a terminal session.`}
          </p>
        ) : (
          messages.map((message) => {
            if (message.role === "assistant" && message.status === "pending") {
              return (
                <div key={message._id} className={cn(bubbleClass, bubbleAssistantClass)}>
                  <span className="inline-block animate-pulse">Thinking…</span>
                </div>
              );
            }
            if (message.role === "assistant" && message.status === "error") {
              return (
                <div key={message._id} className={cn(bubbleClass, bubbleErrorClass)}>
                  {message.error ?? "Reply failed."}
                </div>
              );
            }
            return (
              <div
                key={message._id}
                className={cn(bubbleClass, message.role === "user" ? bubbleUserClass : bubbleAssistantClass)}
              >
                {message.content}
              </div>
            );
          })
        )}
      </div>

      {pendingApprovals.length ? (
        <div className="grid gap-2 border-t bg-secondary px-3 py-2">
          {pendingApprovals.map((approval) => (
            <div key={approval._id} className="grid gap-1.5 rounded-[10px] border border-gold px-2.5 py-2">
              <p className="m-0 text-[13px] font-bold">{approval.title}</p>
              {approval.details?.command ? (
                <pre className="m-0 max-h-[90px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {approval.details.command}
                </pre>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-lg border border-primary bg-primary px-3 py-[5px] text-[12.5px] font-bold text-primary-foreground"
                  onClick={() => void decideApproval({ approvalId: approval._id, decision: "accepted" } as any)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-lg border bg-card px-3 py-[5px] text-[12.5px] font-bold"
                  onClick={() => void decideApproval({ approvalId: approval._id, decision: "declined" } as any)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t bg-secondary px-3 py-2.5">
        <textarea
          className="min-h-[38px] max-h-[120px] flex-1 resize-none rounded-[10px] border bg-card px-[11px] py-[9px] text-[13.5px]"
          value={draft}
          placeholder={`Message ${scope.kind === "project" ? "about this project" : scope.label}…`}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="inline-flex size-[38px] cursor-pointer items-center justify-center rounded-[10px] border-0 bg-primary text-primary-foreground disabled:cursor-default disabled:opacity-50"
          disabled={!draft.trim() || sending}
          onClick={() => void send()}
          aria-label="Send message"
        >
          <SendHorizontal size={16} aria-hidden />
        </button>
      </div>
    </section>
  );
}
