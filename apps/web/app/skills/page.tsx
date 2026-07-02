import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell } from "../components";
import { NotConfigured } from "../hubs/not-configured";
import { SkillsListContent } from "../hubs/skills";

export default function SkillsPage() {
  return <AppShell>{isLiveConfigured() ? <SkillsListContent /> : <NotConfigured />}</AppShell>;
}
