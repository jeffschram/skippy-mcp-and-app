import { AppShell, PageHeader, icons } from "../ui";
import { pendingActions } from "../sample-data";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LivePendingActionsContent } from "../live-pages";

export default function PendingActionsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Pending actions" title="External effects stay approval-gated." />
        <LivePendingActionsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Pending actions" title="External effects stay approval-gated." />
      <div className="item-list">
        {pendingActions.map((action) => (
          <article className="item" key={action.title}>
            <span className="item-icon">
              <icons.MessageSquareText size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{action.title}</p>
              <p className="item-meta">{action.detail}</p>
            </div>
            <span className="badge red">{action.badge}</span>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
