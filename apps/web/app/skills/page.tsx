import { redirect } from "next/navigation";

// The skills listing lives in the consolidated Agents hub now. Public
// /skills/[slug] pages stay at their canonical URLs — external schedulers and
// the MCP fallback path load them directly.
export default function SkillsPage() {
  redirect("/agents?tab=skills");
}
