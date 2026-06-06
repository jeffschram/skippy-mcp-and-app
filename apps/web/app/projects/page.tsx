import { AppShell, PageHeader, icons } from "../ui";
import { projects } from "../sample-data";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveProjectsContent } from "../live-pages";

export default function ProjectsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Projects" title="Accepted projects and active tasks." />
        <LiveProjectsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Projects" title="Accepted projects and active tasks." />
      <div className="grid">
        {projects.map((project) => (
          <section className="card section span-6" key={project.title}>
            <div className="settings-row">
              <div>
                <h2>{project.title}</h2>
                <p className="muted">{project.summary}</p>
              </div>
              <span className="badge blue">{project.status}</span>
            </div>
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
        ))}
      </div>
    </AppShell>
  );
}
