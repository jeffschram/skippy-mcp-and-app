import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { ProjectsListContent } from "../hubs/projects";
import { NotConfigured } from "../hubs/not-configured";

export default function ProjectsPage() {
  return <AppShell>{isLiveConfigured() ? <ProjectsListContent /> : <NotConfigured />}</AppShell>;
}
