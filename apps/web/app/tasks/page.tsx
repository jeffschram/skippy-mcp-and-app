import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell, PageHeader } from "../components";
import { LifeTasksPage } from "../hubs/life-tasks";
import { NotConfigured } from "../hubs/not-configured";

export default function TasksPage() {
  return (
    <AppShell>
      <PageHeader
        title="Tasks"
        description="Everything that isn't a project: obligations, errands, and things you'd like to get to."
      />
      {isLiveConfigured() ? <LifeTasksPage /> : <NotConfigured />}
    </AppShell>
  );
}
