import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { ReviewContent } from "../hubs/review";
import { NotConfigured } from "../hubs/not-configured";

export default function ReviewPage() {
  return <AppShell>{isLiveConfigured() ? <ReviewContent /> : <NotConfigured />}</AppShell>;
}
