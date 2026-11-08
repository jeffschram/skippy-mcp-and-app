"use client";

import Link from "next/link";
import { attentionHref } from "../../../../convex/attentionModel";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { useViewerReady } from "./use-viewer";
import { itemClass, itemListClass, itemMetaClass, itemTitleClass, mutedClass, pageHeaderClass, textButtonClass } from "../page-classes";

export function ActivityContent() {
  const ready = useViewerReady();
  const { results, status, loadMore } = usePaginatedQuery(api.knowledge.activityForViewer, ready ? {} : "skip", { initialNumItems: 40 });
  const actions = usePaginatedQuery(api.knowledge.actionHistoryForViewer, ready ? {} : "skip", { initialNumItems: 20 });
  return <LiveGate>
    <div className={pageHeaderClass}><div><h1>Activity</h1><p className={mutedClass}>What Skippy did, including objects created and action results.</p></div></div>
    {status === "LoadingFirstPage" ? <p role="status">Loading activity…</p> : results.length === 0 ? <p className={mutedClass}>No activity yet.</p> : <div className={itemListClass}>
      {results.map(event => <article key={event._id} className={itemClass}><div>
        <p className={itemTitleClass}>{event.entityRef ? <Link href={attentionHref(event.entityRef.entityType, event.entityRef.entityId)}>{event.summary}</Link> : event.summary}</p>
        {event.actionStatus && <p className={itemMetaClass}>Execution: {event.actionStatus === "approved" ? "queued" : event.actionStatus}</p>}
        {event.warning && <p>{event.warning}</p>}
        {event.error && <p className="text-red-600">{event.error}</p>}
        <p className={itemMetaClass}>{new Date(event.timestamp).toLocaleString()} · {event.actorType}</p>
        {event.sources?.map((source: { href: string; label: string }, index: number) => /^https?:\/\//.test(source.href) ? <a key={`${source.href}:${index}`} className="mr-3 text-sm underline" href={source.href} target="_blank" rel="noreferrer">{source.label}</a> : null)}
      </div></article>)}
    </div>}
    {status === "CanLoadMore" && <button type="button" className={textButtonClass} onClick={() => loadMore(40)}>Load more</button>}
    {status === "LoadingMore" && <p role="status">Loading more…</p>}
    <details className="mt-6">
      <summary className="cursor-pointer">Execution history</summary>
      <p className={mutedClass}>Current execution state, including actions recorded before the activity log.</p>
      <div className={itemListClass}>{actions.results.map(action => <article className={itemClass} key={action._id}><div>
        <p className={itemTitleClass}>{action.subject ?? action.actionType}</p>
        <p className={itemMetaClass}>{new Date(action.executedAt ?? action.updatedAt).toLocaleString()} · {action.status === "approved" ? "queued" : action.status}</p>
        {action.reviewWarning && <p>{action.reviewWarning}</p>}
        {action.error && <p className="text-red-600">{action.error}</p>}
        {action.actionType === "waiting_nudge" && action.status === "approved" && <p className={mutedClass}>Saved; automatic message delivery is unavailable.</p>}
      </div></article>)}</div>
      {actions.status === "CanLoadMore" && <button type="button" className={textButtonClass} onClick={() => actions.loadMore(20)}>Load more actions</button>}
      {(actions.status === "LoadingFirstPage" || actions.status === "LoadingMore") && <p role="status">Loading actions…</p>}
      {actions.status === "Exhausted" && actions.results.length === 0 && <p className={mutedClass}>No external actions yet.</p>}
    </details>
  </LiveGate>;
}
