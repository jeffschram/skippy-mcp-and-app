import Link from "next/link";
import { AppShell, PageHeader, icons } from "../../ui";
import { projects } from "../../sample-data";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { LiveProjectDetailContent } from "../../live-pages";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);

  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Project" title="Project detail" />
        <LiveProjectDetailContent projectId={projectId} />
      </AppShell>
    );
  }

  const project = projects.find((candidate) => candidate.title === projectId);

  if (!project) {
    return (
      <AppShell>
        <PageHeader eyebrow="Project" title="Project not found" />
        <p className="muted">
          This project may have been removed. <Link href="/projects">Back to projects</Link>.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Project" title={project.title} />
      <div className="grid">
        <section className="card section span-12">
          <div className="settings-row">
            <div>
              <h2>{project.title}</h2>
              <p className="muted">{project.summary}</p>
            </div>
            <span className="badge blue">{project.status}</span>
          </div>
        </section>
        <section className="card section span-12">
          <h2>Tasks</h2>
          <div className="item-list">
            {project.tasks.map((task) => (
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
        </section>
      </div>
    </AppShell>
  );
}
