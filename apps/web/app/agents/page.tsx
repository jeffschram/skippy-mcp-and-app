import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { NotConfigured } from "../hubs/not-configured";
import { AgentsHubContent } from "../hubs/agents-hub";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  return (
    <AppShell>
      {isLiveConfigured() ? <AgentsHubContent initialTab={params?.tab} /> : <NotConfigured />}
    </AppShell>
  );
}
