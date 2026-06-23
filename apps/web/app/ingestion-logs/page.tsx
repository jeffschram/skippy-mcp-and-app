import { AppShell, PageHeader } from "../ui";
import { isLiveConfigured } from "../../lib/skippy-api";
import { LiveIngestionLogsContent } from "../live-pages";

export default function IngestionLogsPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Ingestion logs" title="Source runs and decisions." />
      {isLiveConfigured() ? (
        <LiveIngestionLogsContent />
      ) : (
        <p className="muted">Ingestion logs are available when the app is connected to Convex.</p>
      )}
    </AppShell>
  );
}
