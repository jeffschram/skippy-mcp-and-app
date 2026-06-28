import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell } from "../../components";
import { ProjectBoardContent } from "../../hubs/project-board";
import { NotConfigured } from "../../hubs/not-configured";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);

  return (
    <AppShell>{isLiveConfigured() ? <ProjectBoardContent projectId={projectId} /> : <NotConfigured />}</AppShell>
  );
}
