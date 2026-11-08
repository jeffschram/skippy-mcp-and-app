import { isLiveConfigured } from "../../../lib/skippy-api";
import { AppShell } from "../../components";
import { ActivityContent } from "../../hubs/activity";
import { NotConfigured } from "../../hubs/not-configured";

export default function ReviewHistoryPage() {
  return <AppShell>{isLiveConfigured() ? <ActivityContent /> : <NotConfigured />}</AppShell>;
}
