import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { LifeTasksPage } from "../hubs/life-tasks";
import { NotConfigured } from "../hubs/not-configured";

export default function TasksPage() {
  return <AppShell>{isLiveConfigured() ? <LifeTasksPage /> : <NotConfigured />}</AppShell>;
}
