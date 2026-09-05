"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { UNREAD_LINK_FOCUS_MAX_AGE_DAYS, isLinkFocusCandidate } from "@skippy/shared";
import { cn } from "@/lib/utils";
import { api } from "../lib/skippy-api";
import { formatDate, formatRelative } from "../lib/display";
import { LiveGate } from "./live-auth";
import {
  badgeBlueClass,
  badgeClass,
  badgeGoldClass,
  badgeRedClass,
  cardClass,
  itemClass,
  itemIconActiveClass,
  itemIconClass,
  itemListClass,
  itemMetaClass,
  itemTitleClass,
  mutedClass,
  projectRowSideClass,
  sectionClass,
  textButtonClass,
  textButtonCompactClass,
  toolbarClass,
} from "./page-classes";
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
  unread: cn(badgeClass, badgeBlueClass),
  read: badgeClass,
  saved: cn(badgeClass, badgeGoldClass),
  discarded: cn(badgeClass, badgeRedClass),
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
    <article className={itemClass} id={`link-${link._id}`}>
      <span className={cn(itemIconClass, link.status === "unread" && !agedOut && itemIconActiveClass)}>
        <icons.LinkIcon size={17} aria-hidden />
      </span>
      <div>
        <p className={itemTitleClass}>{link.title ?? link.url}</p>
        {link.summary ? <p className={itemMetaClass}>{link.summary}</p> : null}
        <p className={itemMetaClass}>{meta}</p>
      </div>
      <span className={projectRowSideClass}>
        <a
          className={cn(textButtonClass, textButtonCompactClass)}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${link.url} in a new tab`}
        >
          Open
        </a>
        {link.status === "unread" ? (
          <button className={cn(textButtonClass, textButtonCompactClass)} type="button" disabled={busy} onClick={() => void setStatus("read")}>
            Mark read
          </button>
        ) : null}
        {link.status !== "discarded" ? (
          <button
            className={cn(textButtonClass, textButtonCompactClass)}
            type="button"
            disabled={busy}
            onClick={() => void setStatus("discarded")}
          >
            Discard
          </button>
        ) : null}
        <span className={linkStatusBadgeClass[link.status] ?? badgeClass}>{link.status}</span>
      </span>
    </article>
  );
}

function NoteRow({ note }: { note: AnyRecord }) {
  const body = typeof note.body === "string" ? note.body : "";
  const excerpt = body.length > 180 ? `${body.slice(0, 180).trimEnd()}…` : body;

  return (
    <article className={itemClass} id={`note-${note._id}`}>
      <span className={itemIconClass}>
        <icons.BookOpen size={17} aria-hidden />
      </span>
      <div>
        <p className={itemTitleClass}>{note.title ?? excerpt ?? "Untitled note"}</p>
        {note.title && excerpt ? <p className={itemMetaClass}>{excerpt}</p> : null}
        <p className={itemMetaClass}>{formatDate(note.createdAt)}</p>
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
  const [filter, setFilter] = useState<"all" | "links" | "notes">("all");

  useHashScroll(Boolean(linksData && notesData));

  return (
    <LiveGate>
      {!linksData || !notesData ? (
        <section className={cn(cardClass, sectionClass)}>
          <h2>Loading links and notes</h2>
        </section>
      ) : (
        <div>
          <div className={cn(toolbarClass, "mb-4")} role="group" aria-label="Filter library">
            {([
              ["all", "All", linksData.links.length + notesData.notes.length],
              ["links", "Links", linksData.links.length],
              ["notes", "Notes", notesData.notes.length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                className={cn(badgeClass, filter === key && badgeBlueClass)}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label} · {count}
              </button>
            ))}
          </div>
          <p className={cn(mutedClass, "mb-4")}>
            Links and notes live together here. Unread links leave focus after {UNREAD_LINK_FOCUS_MAX_AGE_DAYS} days, but stay saved.
          </p>
          <div className={itemListClass}>
            {(filter === "all" || filter === "links") && linksData.links.map((link: AnyRecord) => (
              <LinkRow key={link._id} link={link} />
            ))}
            {(filter === "all" || filter === "notes") && notesData.notes.map((note: AnyRecord) => (
              <NoteRow key={note._id} note={note} />
            ))}
            {((filter === "links" && linksData.links.length === 0) ||
              (filter === "notes" && notesData.notes.length === 0) ||
              (filter === "all" && linksData.links.length + notesData.notes.length === 0)) ? (
              <p className={mutedClass}>Nothing saved here yet.</p>
            ) : null}
          </div>
        </div>
      )}
    </LiveGate>
  );
}
