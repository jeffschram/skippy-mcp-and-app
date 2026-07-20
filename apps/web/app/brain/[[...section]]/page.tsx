import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell } from "../../components";
import { BrainContent } from "../../hubs/brain";
import { NotConfigured } from "../../hubs/not-configured";

// Optional catch-all so every Brain sub-view owns a URL: /brain (Memory),
// /brain/links, /brain/contacts, /brain/goals, etc. The first segment selects
// the tab; unknown segments fall back to Memory inside BrainContent.
export default async function BrainPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  return (
    <AppShell>
      {isLiveConfigured() ? <BrainContent section={section?.[0]} /> : <NotConfigured />}
    </AppShell>
  );
}
