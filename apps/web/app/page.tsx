import { AppShell, icons } from "./ui";
import { pendingActions, triageItems } from "./sample-data";
import { isLiveConfigured } from "../lib/skippy-api";
import { LiveHomeContent } from "./live-pages";

export default function HomePage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <LiveHomeContent />
      </AppShell>
    );
  }

  const hasDecisionQueueItems = triageItems.length > 0 || pendingActions.length > 0;

  return (
    <AppShell>
      <div className="grid">
        <section className={`card section ${hasDecisionQueueItems ? "span-8" : "span-12"} focus-summary`}>
          <div>
            <p className="eyebrow">Now</p>
            <h1 className="focus-heading">Use the importance rubric well.</h1>
            <ul className="focus-summary-list">
              <li>Store what clears the bar.</li>
              <li>Keep source-backed context concise.</li>
              <li>Refresh focus from accepted knowledge.</li>
            </ul>
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

        {hasDecisionQueueItems ? (
          <section className="span-4 section">
            <h2>Decision queue</h2>
            <div className="item-list">
              {triageItems.length > 0 ? (
                <div className="item">
                  <span className="item-icon">
                    <icons.Archive size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">{triageItems.length} unclear signals</p>
                    <p className="item-meta">Fallback items that need a rubric decision.</p>
                  </div>
                  <span className="badge gold">Review</span>
                </div>
              ) : null}
              {pendingActions.length > 0 ? (
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
              ) : null}
            </div>
          </section>
        ) : null}

      </div>
    </AppShell>
  );
}
