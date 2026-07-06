import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { BrainContent } from "../hubs/brain";
import { NotConfigured } from "../hubs/not-configured";

export default function MemoryPage() {
  return <AppShell>{isLiveConfigured() ? <BrainContent /> : <NotConfigured />}</AppShell>;
}
