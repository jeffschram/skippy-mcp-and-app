"use client";
import Link from 'next/link';
import { Check } from 'lucide-react';
import { IconButton, LoadingRow, Section } from '../components';
import { AgendaRow } from './agenda';
import { homeDayKey, type HomeRow } from './home-period-helpers';
import type { TodayCandidate } from '../../../../convex/todayModel';
import { textButtonClass, textButtonCompactClass } from '../page-classes';

export function HomePeriodCard({ title, rows, busyId, onComplete, timeZone, weekly = false }: {
  title: string; rows: HomeRow[] | undefined; busyId: string | null; onComplete: (item: TodayCandidate) => void; timeZone: string; weekly?: boolean;
}) {
  let previousDay = '';
  return <Section title={title} action={weekly ? <Link className={`${textButtonClass} ${textButtonCompactClass}`} href="/tasks">Full agenda</Link> : undefined}>
    {!rows ? <LoadingRow label="Loading your plan…" /> : !rows.length ? <p className="text-sm text-muted-foreground">Nothing planned or scheduled.</p> :
      <ol className="m-0 list-none p-0">{rows.map(row => {
        const action = row.action;
        const canComplete = action && (action.canComplete || action.kind === 'step' || action.kind === 'recurrence');
        const date = row.scheduled ? homeDayKey(row.scheduled.at, row.scheduled.isAllDay ? 'UTC' : timeZone) : '';
        const showDate = weekly && date && date !== previousDay;
        previousDay = date;
        return <li key={row.key}>
          {showDate ? <p className="mb-1 mt-4 text-xs font-bold uppercase text-muted-foreground">{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`))}</p> : null}
          <div className="flex items-center gap-3 border-b py-2">
            {canComplete ? <IconButton small title="Mark done" aria-label={`Mark ${row.title} done`} disabled={busyId !== null} onClick={() => onComplete(action)}><Check size={16} /></IconButton> : null}
            <div className="min-w-0 flex-1">
              {row.scheduled ? <AgendaRow item={{ ...row.scheduled, title: row.title, ...(action ? { href: action.href } : {}) }} timeZone={timeZone} />
                : action?.kind === 'approval' ? <button className="text-left font-medium hover:underline" onClick={() => window.dispatchEvent(new CustomEvent('skippy:open-chat'))}>{row.title}</button>
                : <Link href={action?.href ?? '/tasks'} className="font-medium hover:underline">{row.title}</Link>}
            </div>
          </div>
        </li>;
      })}</ol>}
  </Section>;
}
