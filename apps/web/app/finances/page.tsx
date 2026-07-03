import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { FinancesContent } from "../hubs/finances";
import { NotConfigured } from "../hubs/not-configured";

export default function FinancesPage() {
  return <AppShell>{isLiveConfigured() ? <FinancesContent /> : <NotConfigured />}</AppShell>;
}
