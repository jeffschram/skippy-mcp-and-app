import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell } from "../../components";
import { ReviewHistoryContent } from "../../hubs/review";
import { NotConfigured } from "../../hubs/not-configured";

// Settled approvals live behind this quiet link — a queue is not a log
// (ui-ux-improvement-plan.md, one-queue decision Sep 4).
export default function ReviewHistoryPage() {
  return <AppShell>{isLiveConfigured() ? <ReviewHistoryContent /> : <NotConfigured />}</AppShell>;
}
