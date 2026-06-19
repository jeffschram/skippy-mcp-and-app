import { AppShell, PageHeader, icons } from "../ui";
import { triageItems } from "../sample-data";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveTriageContent } from "../live-pages";

export default function TriagePage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Review" title="Unclear signals needing a decision." />
        <LiveTriageContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Review" title="Unclear signals needing a decision." />
      <div className="item-list">
        {triageItems.map((item) => (
          <article className="item" key={item.title}>
            <span className="item-icon">
              <icons.Archive size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{item.title}</p>
              <p className="item-meta">
                {item.type} signal, confidence {item.confidence}
              </p>
            </div>
            <div className="toolbar">
              <button className="icon-button" type="button" title="Approve">
                <icons.Check size={17} aria-hidden />
              </button>
              <button className="icon-button" type="button" title="Reject">
                <icons.Archive size={17} aria-hidden />
              </button>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
