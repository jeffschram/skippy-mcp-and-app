import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell } from "../../components";
import { NotConfigured } from "../../hubs/not-configured";
import { SkillDetailContent } from "../../hubs/skills";

export default async function SkillDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AppShell>
      {isLiveConfigured() ? <SkillDetailContent slug={decodeURIComponent(slug)} /> : <NotConfigured />}
    </AppShell>
  );
}
