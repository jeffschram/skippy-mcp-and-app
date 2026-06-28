import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { SettingsContent } from "../hubs/settings";
import { NotConfigured } from "../hubs/not-configured";

export default function SettingsPage() {
  return <AppShell>{isLiveConfigured() ? <SettingsContent /> : <NotConfigured />}</AppShell>;
}
