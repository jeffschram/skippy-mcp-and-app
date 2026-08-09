"use client";

/**
 * Page-aware chat panel, mounted on every page via AppShell.
 *
 * The scope follows the route: project pages bind to that project's General
 * chat; every other page binds to a per-page chat (home, agenda, finances, ...).
 * Replies come from the brain's configured LLM provider via convex/chats.ts —
 * the lightweight conversational path, deliberately separate from the run
 * machinery. Hidden behind a floating toggle; on small screens the panel opens
 * as a near-fullscreen sheet.
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
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const queryArgs =
    scope.kind === "project" ? { projectId: scope.projectId as any } : { pageKey: scope.pageKey };
  const data = useQuery(api.chats.chatForScopeForViewer, isAuthenticated && open ? queryArgs : "skip") as
    | AnyRecord
    | undefined;
  const sendMessage = useMutation(api.chats.sendChatMessageForViewer);

  const messages: AnyRecord[] = data?.messages ?? [];

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
      await sendMessage({ ...queryArgs, content } as any);
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
          <span className={styles.headerContext}>{contextLine}</span>
        </span>
        <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close chat">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className={styles.messages} ref={messagesRef}>
        {messages.length === 0 ? (
          <p className={styles.empty}>
            {scope.kind === "project"
              ? "Ask about this project — plans, tasks, status. Code changes go through a task's Execute action."
              : `Ask about ${scope.label.toLowerCase()} — this chat sees which page you're on.`}
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
