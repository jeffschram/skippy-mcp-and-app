import Link from "next/link";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell, PageHeader } from "../../components";
import { LiveInterviewDetail } from "../ui";
import { NotConfigured } from "../../hubs/not-configured";

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interviewId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Interview"
        title="Guided check-in"
        action={
          <Link className="text-button" href="/brain">
            Back to Brain
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveInterviewDetail interviewId={interviewId} /> : <NotConfigured />}
    </AppShell>
  );
}
