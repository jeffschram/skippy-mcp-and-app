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
import { api } from "../../lib/skippy-api";
import styles from "./chat-panel.module.css";

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
      <button type="button" className={styles.toggle} onClick={() => setOpen(true)} aria-label="Open chat">
        <MessageCircle size={17} aria-hidden />
        Chat
      </button>
    );
  }

  const contextLine =
    scope.kind === "project" ? (data?.chat?.title ?? "Project chat") : `${scope.label} · page chat`;

  return (
    <section className={styles.panel} aria-label="Skippy chat">
      <header className={styles.header}>
        <MessageCircle size={16} aria-hidden />
        <span className={styles.headerTitle}>
          Chat
          <span className={styles.headerContext}>
            {contextLine}
            {boundHarness ? ` · ${boundHarness}` : ""}
          </span>
        </span>
        {!boundHarness ? (
          <select
            className={styles.harnessSelect}
            value={pickedHarness}
            onChange={(event) => setPickedHarness(event.target.value as "claude" | "codex")}
            aria-label="Harness for this chat"
            title="Which local harness answers this chat (fixed after the first message)"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        ) : null}
        <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close chat">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className={styles.messages} ref={messagesRef}>
        {messages.length === 0 ? (
          <p className={styles.empty}>
            {scope.kind === "project"
              ? "Chat with your local harness about this project — it runs in the project checkout with your normal tools."
              : `Chat with your local harness from the ${scope.label} page — same capabilities as a terminal session.`}
          </p>
        ) : (
          messages.map((message) => {
            if (message.role === "assistant" && message.status === "pending") {
              return (
                <div key={message._id} className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                  <span className={styles.pendingDots}>Thinking…</span>
                </div>
              );
            }
            if (message.role === "assistant" && message.status === "error") {
              return (
                <div key={message._id} className={`${styles.bubble} ${styles.bubbleError}`}>
                  {message.error ?? "Reply failed."}
                </div>
              );
            }
            return (
              <div
                key={message._id}
                className={`${styles.bubble} ${message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}
              >
                {message.content}
              </div>
            );
          })
        )}
      </div>

      {pendingApprovals.length ? (
        <div className={styles.approvals}>
          {pendingApprovals.map((approval) => (
            <div key={approval._id} className={styles.approvalCard}>
              <p className={styles.approvalTitle}>{approval.title}</p>
              {approval.details?.command ? (
                <pre className={styles.approvalDetail}>{approval.details.command}</pre>
              ) : null}
              <div className={styles.approvalActions}>
                <button
                  type="button"
                  className={styles.approve}
                  onClick={() => void decideApproval({ approvalId: approval._id, decision: "accepted" } as any)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={styles.decline}
                  onClick={() => void decideApproval({ approvalId: approval._id, decision: "declined" } as any)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.composer}>
        <textarea
          className={styles.input}
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
          className={styles.send}
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
