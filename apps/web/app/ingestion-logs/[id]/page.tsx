import Link from "next/link";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell, PageHeader } from "../../components";
import { LiveIngestionLogDetailContent } from "../../live-pages";
import { NotConfigured } from "../../hubs/not-configured";

export default async function IngestionLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ingestionRunId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Activity"
        title="Ingestion run detail"
        action={
          <Link className="text-button" href="/settings">
            Back to Settings
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveIngestionLogDetailContent ingestionRunId={ingestionRunId} /> : <NotConfigured />}
    </AppShell>
  );
}
