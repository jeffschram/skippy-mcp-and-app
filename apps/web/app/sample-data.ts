export const focusItems = [
  {
    title: "Reply to Morgan about the Convex ingestion path",
    reason: "Blocks the MCP write pipeline and has fresh source context.",
    badge: "Follow-up",
  },
  {
    title: "Tune the importance rubric",
    reason: "A few unclear signals need a decision before Skippy learns how to handle similar items next time.",
    badge: "Review",
  },
  {
    title: "Finish task completion sync policy",
    reason: "Needed before external reminder completion can be queued safely.",
    badge: "Policy",
  },
];

export const projects = [
  {
    title: "Skippy MCP and PWA",
    summary: "Canonical second-brain backend, MCP ingest surface, and focused review app.",
    status: "in progress",
    tasks: ["Wire Convex schema", "Ingest accepted objects", "Tune importance rubric"],
  },
  {
    title: "Home operations refresh",
    summary: "Collect reminders, contacts, and maintenance notes into a shared context graph.",
    status: "planned",
    tasks: ["Collect open reminders", "Confirm priority people", "Review recurring commitments"],
  },
];

export const people = [
  { name: "Morgan Lee", context: "Convex implementation review", badge: "Work" },
  { name: "Avery Chen", context: "Pending follow-up on reminder sync", badge: "Project" },
];

export const companies = [
  { name: "Convex", context: "Backend/database platform", badge: "Vendor" },
  { name: "Vercel", context: "Web deployment target", badge: "Vendor" },
];

export const triageItems = [
  { title: "Create project for scheduled harness workflow", type: "Project", confidence: "72%" },
  { title: "Remember preference: short task titles", type: "Memory", confidence: "61%" },
  { title: "Follow up with Morgan next week", type: "Task", confidence: "84%" },
];

export const pendingActions = [
  { title: "Draft reply to Morgan", detail: "Outbound email requires approval.", badge: "Email" },
  { title: "Complete external reminder", detail: "Queued from a Skippy task completion.", badge: "Reminder" },
];
