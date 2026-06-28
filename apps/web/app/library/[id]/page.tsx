import Link from "next/link";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell, PageHeader } from "../../components";
import { LiveMemoryDetailContent } from "../../live-pages";
import { NotConfigured } from "../../hubs/not-configured";

export default async function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const memoryId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Memory"
        title="Memory detail"
        action={
          <Link className="text-button" href="/brain">
            Back to Brain
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveMemoryDetailContent memoryId={memoryId} /> : <NotConfigured />}
    </AppShell>
  );
}
