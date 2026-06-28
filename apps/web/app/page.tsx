import { isLiveConfigured } from "../lib/skippy-api";
import { AppShell } from "./components";
import { TodayContent } from "./hubs/today";
import { NotConfigured } from "./hubs/not-configured";

export default function HomePage() {
  return <AppShell>{isLiveConfigured() ? <TodayContent /> : <NotConfigured />}</AppShell>;
}
