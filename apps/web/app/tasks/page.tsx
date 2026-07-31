import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell, PageHeader } from "../components";
import { LifeTasksPage } from "../hubs/life-tasks";
import { NotConfigured } from "../hubs/not-configured";

export default function TasksPage() {
  return (
    <AppShell>
      <PageHeader
        title="Agenda"
        description="Everything that isn't a project — tasks, events, and repeating obligations in one list."
      />
      {isLiveConfigured() ? <LifeTasksPage /> : <NotConfigured />}
    </AppShell>
  );
}
