import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveGoalsContent } from "../live-pages";

const sampleGoals = [
  { title: "Ship the Skippy MCP + PWA", description: "Get the second-brain backend and review app to a usable daily state.", status: "active" },
  { title: "Tame the inbox", description: "Only keep email that affects money, access, commitments, or relationships.", status: "active" },
];

export default function GoalsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Goals" title="Active goals shape the importance rubric." />
        <LiveGoalsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Goals" title="Active goals shape the importance rubric." />
      <div className="item-list">
        {sampleGoals.map((goal) => (
          <article className="item" key={goal.title}>
            <span className="item-icon">
              <icons.Target size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{goal.title}</p>
              <p className="item-meta">{goal.description}</p>
            </div>
            <span className="badge blue">{goal.status}</span>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
