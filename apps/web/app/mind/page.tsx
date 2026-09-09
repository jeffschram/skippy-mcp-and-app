import { AppShell } from "../components";
import { isLiveConfigured } from "../../lib/skippy-api";
import { NotConfigured } from "../hubs/not-configured";
import { MindContent } from "./mind-content";

export default function MindPage() {
  return (
    <AppShell>
      {isLiveConfigured() ? <MindContent /> : <NotConfigured />}
    </AppShell>
  );
}
