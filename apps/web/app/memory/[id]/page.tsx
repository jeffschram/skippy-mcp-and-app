import Link from "next/link";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell, PageHeader } from "../../components";
import { NotConfigured } from "../../hubs/not-configured";
import { LiveMemoryDetailContent } from "../../live-pages";
import { textButtonClass } from "../../page-classes";

export default async function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const memoryId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Memory"
        title="Memory detail"
        action={
          <Link className={textButtonClass} href="/memory">
            Back to Memory
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveMemoryDetailContent memoryId={memoryId} /> : <NotConfigured />}
    </AppShell>
  );
}
