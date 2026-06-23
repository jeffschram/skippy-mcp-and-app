import Link from "next/link";
import { AppShell, PageHeader } from "../../ui";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { LiveIngestionLogDetailContent } from "../../live-pages";

export default async function IngestionLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ingestionRunId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Ingestion log"
        title="Run detail"
        action={
          <Link className="text-button" href="/ingestion-logs">
            Back to logs
          </Link>
        }
      />
      {isLiveConfigured() ? (
        <LiveIngestionLogDetailContent ingestionRunId={ingestionRunId} />
      ) : (
        <p className="muted">Ingestion logs are available when the app is connected to Convex.</p>
      )}
    </AppShell>
  );
}
