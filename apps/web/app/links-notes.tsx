"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { UNREAD_LINK_FOCUS_MAX_AGE_DAYS, isLinkFocusCandidate } from "@skippy/shared";
import { api } from "../lib/skippy-api";
import { formatDate, formatRelative } from "../lib/display";
import { LiveGate } from "./live-auth";
import { icons } from "./ui";

type AnyRecord = Record<string, any>;

function useViewerReady() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: AnyRecord | null }
    | null
    | undefined;

  return Boolean(viewer?.brain);
}

// Deep links from elsewhere (e.g. the Home "Actions taken" digest) arrive as
// /brain/links#link-<id> or #note-<id>. The target row only exists once its
// Convex query resolves, so re-run whenever `ready` flips and briefly highlight
// the row so the eye lands on it.
function useHashScroll(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.setAttribute("data-anchor-flash", "true");
    const timer = window.setTimeout(() => el.removeAttribute("data-anchor-flash"), 2000);
    return () => window.clearTimeout(timer);
  }, [ready]);
}

function domainForUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const linkStatusBadgeClass: Record<string, string> = {
  unread: "badge blue",
  read: "badge",
  saved: "badge gold",
  discarded: "badge red",
};

function LinkRow({ link }: { link: AnyRecord }) {
  const updateStatus = useMutation(api.knowledge.updateLinkStatusForViewer);
  const [busy, setBusy] = useState(false);
  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      await updateStatus({ linkId: link._id, status } as any);
    } finally {
      setBusy(false);
    }
  };

  const domain = domainForUrl(link.url);
  const agedOut = link.status === "unread" && !isLinkFocusCandidate(link);
  const meta = [domain, `added ${formatRelative(link.createdAt)}`, agedOut ? "aged out of focus" : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="item" id={`link-${link._id}`}>
      <span className={`item-icon ${link.status === "unread" && !agedOut ? "is-active" : ""}`}>
        <icons.LinkIcon size={17} aria-hidden />
      </span>
      <div>
        <p className="item-title">{link.title ?? link.url}</p>
        {link.summary ? <p className="item-meta">{link.summary}</p> : null}
        <p className="item-meta">{meta}</p>
      </div>
      <span className="project-row-side">
        <a
          className="text-button compact"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${link.url} in a new tab`}
        >
          Open
        </a>
        {link.status === "unread" ? (
          <button className="text-button compact" type="button" disabled={busy} onClick={() => void setStatus("read")}>
            Mark read
          </button>
        ) : null}
        {link.status !== "discarded" ? (
          <button
            className="text-button compact"
            type="button"
            disabled={busy}
            onClick={() => void setStatus("discarded")}
          >
            Discard
          </button>
        ) : null}
        <span className={linkStatusBadgeClass[link.status] ?? "badge"}>{link.status}</span>
      </span>
    </article>
  );
}

function NoteRow({ note }: { note: AnyRecord }) {
  const body = typeof note.body === "string" ? note.body : "";
  const excerpt = body.length > 180 ? `${body.slice(0, 180).trimEnd()}…` : body;

  return (
    <article className="item" id={`note-${note._id}`}>
      <span className="item-icon">
        <icons.BookOpen size={17} aria-hidden />
      </span>
      <div>
        <p className="item-title">{note.title ?? excerpt ?? "Untitled note"}</p>
        {note.title && excerpt ? <p className="item-meta">{excerpt}</p> : null}
        <p className="item-meta">{formatDate(note.createdAt)}</p>
      </div>
    </article>
  );
}

export function LiveLinksAndNotesContent() {
  const viewerReady = useViewerReady();
  const linksData = useQuery(api.knowledge.listLinksForViewer, viewerReady ? {} : "skip") as
    | AnyRecord
    | undefined;
  const notesData = useQuery(api.knowledge.listNotesForViewer, viewerReady ? {} : "skip") as
    | AnyRecord
    | undefined;

  useHashScroll(Boolean(linksData && notesData));

  return (
    <LiveGate>
      {!linksData || !notesData ? (
        <section className="card section">
          <h2>Loading links and notes</h2>
        </section>
      ) : (
        <div className="split-list">
          <section>
            <h2>Links</h2>
            <p className="muted">
              Self-managing: unread links stop feeding focus after {UNREAD_LINK_FOCUS_MAX_AGE_DAYS} days — no
              grooming required. Everything stays stored and searchable here.
            </p>
            <div className="item-list">
              {linksData.links.length === 0 ? <p className="muted">No links captured yet.</p> : null}
              {linksData.links.map((link: AnyRecord) => (
                <LinkRow key={link._id} link={link} />
              ))}
            </div>
          </section>
          <section>
            <h2>Notes</h2>
            <div className="item-list">
              {notesData.notes.length === 0 ? <p className="muted">No notes captured yet.</p> : null}
              {notesData.notes.map((note: AnyRecord) => (
                <NoteRow key={note._id} note={note} />
              ))}
            </div>
          </section>
        </div>
      )}
    </LiveGate>
  );
}
