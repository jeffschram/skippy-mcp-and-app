import { AppShell, PageHeader, icons } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveTasksContent } from "../live-pages";

export default function TasksPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Tasks" title="Unassigned tasks." />
        <LiveTasksContent />
      </AppShell>
    );
  }

  // Static preview: sample tasks all belong to projects, so nothing is unassigned.
  const unassignedTasks: string[] = [];

  return (
    <AppShell>
      <PageHeader eyebrow="Tasks" title="Unassigned tasks." />
      {unassignedTasks.length === 0 ? (
        <p className="muted">No unassigned tasks.</p>
      ) : (
        <div className="item-list">
          {unassignedTasks.map((task) => (
            <article className="item" key={task}>
              <span className="item-icon">
                <icons.Check size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{task}</p>
                <p className="item-meta">Accepted task</p>
              </div>
              <button className="icon-button" type="button" title="Mark done">
                <icons.CircleCheck size={17} aria-hidden />
              </button>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
