import Link from "next/link";
import { AppShell, PageHeader, icons } from "../ui";
import { projects } from "../sample-data";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveProjectsContent } from "../live-pages";

export default function ProjectsPage() {
  if (isLiveConfigured()) {
    return (
      <AppShell>
        <PageHeader eyebrow="Projects" title="Accepted projects." />
        <LiveProjectsContent />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Projects" title="Accepted projects." />
      <div className="item-list">
        {projects.map((project) => (
          <Link
            className="item project-row"
            href={`/projects/${encodeURIComponent(project.title)}`}
            key={project.title}
          >
            <span className="item-icon">
              <icons.BriefcaseBusiness size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">{project.title}</p>
              <p className="item-meta">
                {project.summary}
                {" · "}
                {project.tasks.length} open task{project.tasks.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="project-row-side">
              <span className="badge blue">{project.status}</span>
              <icons.ChevronRight size={18} aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
