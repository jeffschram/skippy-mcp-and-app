/**
 * Per-agent-role MCP tool scoping (docs/agents.md).
 *
 * A role is the "access" leg of agent = instructions + access + context.
 * Tokens without a role keep full tool access (backward compatible). Tokens
 * WITH a role get a deny-by-default allowlist: tools not listed for the role
 * are simply never registered on that connection, so they do not appear in
 * tools/list and cannot be called. New tools therefore never leak into
 * role-scoped tokens by accident.
 *
 * Role keys match convex/mcpTokens.ts validation: "agenda", "finance",
 * "task-executor", and "pm" (bare or parameterized as "pm:{projectId}").
 * Unknown roles resolve to the minimal read-only set as a safety net; token
 * creation validates roles so this should not happen in practice.
 */

/** Tools every role may use: skill loading, context resolution, run bookkeeping. */
const COMMON_TOOLS = [
  "get_skill",
  "get_current_context",
  "update_source_sync_status",
  "record_ingestion_run",
] as const;

/**
 * Agenda Agent: source ingestion + memory + focus. No task execution, no
 * financial writes, no external side effects.
 */
const AGENDA_TOOLS = [
  ...COMMON_TOOLS,
  "get_importance_rubric",
  "ingest_object",
  "submit_candidate_object",
  "capture",
  "capture_thought",
  "record_memory",
  "record_decision",
  "record_principle",
  "submit_memory_review_candidate",
  "list_memory",
  "get_memory_detail",
  "get_context_bundle",
  "link_memory",
  "link_entities",
  "add_source_ref",
  "list_quick_captures",
  "mark_quick_capture_handled",
  "refresh_focus_summary",
  "generate_focus_summary",
  "summarize_focus",
  "ask",
  "list_agenda",
  "list_recurrences",
  "list_life_tasks",
  "upsert_recurrence",
  "update_link_status",
  "upsert_goal",
  "upsert_project",
  "upsert_task",
  "upsert_note",
  "upsert_person",
  "upsert_company",
  "upsert_link",
  "upsert_knowledgeObject",
] as const;

/**
 * Financial Agent: financial tables plus concise anomaly ingestion with
 * provenance. Nothing else.
 */
const FINANCE_TOOLS = [
  ...COMMON_TOOLS,
  "upsert_financial_account",
  "record_financial_transactions",
  "record_financial_balances",
  "get_financial_report",
  "ingest_object",
  "add_source_ref",
] as const;

/**
 * Project Manager Agent: read project state, brief tasks, record reviews and
 * digests. Never executes tasks, never edits plans/notes, never approves.
 */
const PM_TOOLS = [
  ...COMMON_TOOLS,
  "get_project_plan",
  "get_project_notes",
  "get_task_brief",
  "list_tasks_by_state",
  "list_ready_tasks",
  "list_requested_ready_tasks",
  "list_project_files",
  "brief_task",
  "record_entity_review",
  "get_context_bundle",
  "list_memory",
  "ask",
] as const;

/**
 * Task Agent: the existing execution surface — pick up requested Ready tasks,
 * execute, report results, move project files.
 */
const TASK_EXECUTOR_TOOLS = [
  ...COMMON_TOOLS,
  "list_ready_tasks",
  "list_requested_ready_tasks",
  "get_task_brief",
  "mark_task_in_progress",
  "record_task_result",
  "get_project_plan",
  "get_project_notes",
  "list_project_files",
  "get_project_file_manifest",
  "get_project_file",
  "list_task_artifacts",
  "generate_project_file_upload_url",
  "register_project_file",
  "begin_project_file_upload",
  "finalize_project_file_upload",
  "abort_project_file_upload",
  "get_context_bundle",
  "ask",
] as const;

/** Safety net for unknown roles: skill/context reads only. */
const MINIMAL_TOOLS = ["get_skill", "get_current_context"] as const;

export const ROLE_TOOL_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  agenda: new Set(AGENDA_TOOLS),
  finance: new Set(FINANCE_TOOLS),
  pm: new Set(PM_TOOLS),
  "task-executor": new Set(TASK_EXECUTOR_TOOLS),
};

/**
 * Resolve a token role to its tool allowlist.
 * Returns null for unrestricted access (no role on the token).
 */
export function resolveAllowedTools(role: string | undefined | null): ReadonlySet<string> | null {
  if (!role) {
    return null;
  }
  const key = role === "pm" || role.startsWith("pm:") ? "pm" : role;
  return ROLE_TOOL_ALLOWLISTS[key] ?? new Set(MINIMAL_TOOLS);
}
