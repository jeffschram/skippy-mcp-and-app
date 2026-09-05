import { Suspense } from "react";
import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { ReviewContent } from "../hubs/review";
import { NotConfigured } from "../hubs/not-configured";

export default function ReviewPage() {
  return (
    <AppShell>
      {isLiveConfigured() ? (
        // Suspense because ReviewContent reads ?filter= via useSearchParams.
        <Suspense>
          <ReviewContent />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </AppShell>
  );
}
