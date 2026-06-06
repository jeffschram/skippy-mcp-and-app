import { AppShell, PageHeader, icons } from "./ui";
import { focusItems, pendingActions, triageItems } from "./sample-data";
import { isLiveConfigured } from "../lib/skippy-api";
import { LiveHomeContent } from "./live-pages";

export default function HomePage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Now" title="Focus on the next useful move." />
        <LiveHomeContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Now" title="Focus on the next useful move." />
      <div className="grid">
        <section className="card section span-8 focus-summary">
          <div>
            <h2>Current focus</h2>
            <p>
              The brain is centered on getting structured ingestion reliable: finish the candidate
              pipeline, review suggested objects, then tighten the external-action approval path.
            </p>
          </div>
          <div className="toolbar" aria-label="Focus actions">
            <button className="icon-button" type="button" title="Refresh focus">
              <icons.Clock3 size={18} aria-hidden />
            </button>
            <button className="icon-button" type="button" title="Open notifications">
              <icons.Bell size={18} aria-hidden />
            </button>
          </div>
        </section>

        <section className="span-4 section">
          <h2>Review queue</h2>
          <div className="item-list">
            <div className="item">
              <span className="item-icon">
                <icons.Archive size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{triageItems.length} suggestions</p>
                <p className="item-meta">Awaiting approve, reject, correct, merge, or reclassify.</p>
              </div>
              <span className="badge gold">Triage</span>
            </div>
            <div className="item">
              <span className="item-icon">
                <icons.MessageSquareText size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{pendingActions.length} pending actions</p>
                <p className="item-meta">External effects stay separated until reviewed.</p>
              </div>
              <span className="badge red">Approval</span>
            </div>
          </div>
        </section>

        <section className="span-12">
          <h2>Top items</h2>
          <div className="item-list">
            {focusItems.map((item) => (
              <article className="item" key={item.title}>
                <span className="item-icon">
                  <icons.CircleCheck size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{item.title}</p>
                  <p className="item-meta">{item.reason}</p>
                </div>
                <span className="badge blue">{item.badge}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
