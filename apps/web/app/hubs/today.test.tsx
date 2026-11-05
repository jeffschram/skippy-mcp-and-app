import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ plan: { summary: 'One appointment remains. Start with your renewal.', limited: false, items: [
  { id: 'personal', title: 'Renew insurance', kind: 'task', href: '/tasks#task-personal', canComplete: true },
  { id: 'step', title: 'Choose a font', kind: 'step', href: '/projects/p#task-step', canComplete: false },
  { id: 'project', title: 'Review: Skippy update', kind: 'task', href: '/projects/p#task-project', canComplete: false },
] } }));
vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  return { useMutation: () => vi.fn(), useQuery: (ref: any) => {
    const name = getFunctionName(ref);
    if (name === 'today:forViewer') return state.plan;
    if (name === 'knowledge:homeForViewer') return { quickCaptures: [], sourceSyncStatuses: [] };
    if (name === 'agenda:agendaForViewer') return [];
    throw new Error(`Unexpected Home query: ${name}`);
  } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }));
vi.mock('../live-auth', () => ({ LiveGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('./use-viewer', () => ({ useViewerReady: () => true }));
vi.mock('../components', () => ({
  Section: ({ title, children }: { title: ReactNode; children: ReactNode }) => createElement('section', {}, createElement('h2', {}, title), children),
  Button: ({ children }: { children: ReactNode }) => createElement('button', {}, children),
  IconButton: ({ children, ...props }: any) => createElement('button', { 'aria-label': props['aria-label'] }, children),
  Badge: ({ children }: { children: ReactNode }) => createElement('span', {}, children),
  TextArea: () => createElement('textarea'),
  LoadingRow: ({ label }: { label: string }) => createElement('p', {}, label),
  EmptyState: ({ title }: { title: string }) => createElement('p', {}, title),
  useToast: () => vi.fn(),
}));
import { TodayContent } from './today';

describe('consolidated Home', () => {
  it('renders one live briefing and action list alongside Quick Capture and the week', () => {
    const html = renderToStaticMarkup(createElement(TodayContent));
    expect(html).toContain('Home');
    expect(html).toContain(state.plan.summary);
    expect(html).toContain('Today');
    expect(html).toContain('This Week');
    expect(html).toContain('textarea');
    expect(html).toContain('Renew insurance');
    expect(html).toContain('Mark Renew insurance done');
    expect(html).toContain('Mark Choose a font done');
    expect(html).not.toContain('Mark Review: Skippy update done');
    expect(html).not.toContain('Needs attention');
    expect(html).not.toContain('Needs your review');
    expect(html).not.toContain('Turn into task');
    expect(html).not.toContain('/review');
  });
});
