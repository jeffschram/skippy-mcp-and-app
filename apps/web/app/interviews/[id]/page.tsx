import Link from "next/link";
import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell, PageHeader, icons } from "../../ui";
import { LiveInterviewDetail } from "../ui";

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interviewId = decodeURIComponent(id);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Interview"
        title="Guided check-in"
        action={
          <Link className="text-button" href="/interviews">
            Back to interviews
          </Link>
        }
      />
      {isLiveConfigured() ? <LiveInterviewDetail interviewId={interviewId} /> : <StaticInterviewDetail />}
    </AppShell>
  );
}

function StaticInterviewDetail() {
  return (
    <div className="grid">
      <section className="card section span-7">
        <div className="settings-row">
          <div>
            <h2>Weekly review</h2>
            <p className="muted">Question 3 of 4</p>
          </div>
          <span className="badge gold">active</span>
        </div>
        <article className="item">
          <span className="item-icon is-active">
            <icons.MessageSquareText size={17} aria-hidden />
          </span>
          <div>
            <p className="item-title">What did you learn about how you work?</p>
            <p className="item-meta">Patterns, friction, energy, timing, assumptions, or useful constraints.</p>
          </div>
          <span className="badge">static</span>
        </article>
      </section>
      <section className="card section span-5">
        <h2>Previous answers</h2>
        <div className="item-list">
          <article className="item">
            <span className="item-icon">
              <icons.Check size={17} aria-hidden />
            </span>
            <div>
              <p className="item-title">What went well this week?</p>
              <p className="item-meta">Shipped a first-pass review queue and clarified capture rules.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
