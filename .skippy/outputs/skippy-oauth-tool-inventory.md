# Skippy OAuth tool permission inventory

Proposed registry for the 83 tool registrations in `apps/mcp-server/src/mcp-server.ts` at `febba07`. This is an implementation input, not an enforced policy. Scope names depend on the provider spike. Both scopes cover all exposed owner domains; write access also requires read access. Existing legacy role allowlists remain separate.

Read candidates follow current read-only descriptors. Synthesis tools `ask` and `summarize_focus`, plus `get_current_context`, conservatively require both grants until their complete call graphs prove they cannot write derived state. Inspect every tool's side effects before finalizing; do not use name prefixes or existing hints as authorization. Private resource and prompt callbacks also need checks even though they are not tools.

For each row, implementation must add matching top-level oauth2 securitySchemes and `_meta.securitySchemes`, enforce the exact grants before data access, and set explicit readOnlyHint, destructiveHint and openWorldHint after reviewing actual behavior. Test the registered tools/list output against the finalized registry so additions fail closed.

| Tool | Proposed required scopes |
| --- | --- |
| `abort_project_file_upload` | `skippy:read + skippy:write` |
| `add_source_ref` | `skippy:read + skippy:write` |
| `answer_interview_question` | `skippy:read + skippy:write` |
| `archive_interview` | `skippy:read + skippy:write` |
| `ask` | `skippy:read + skippy:write` |
| `begin_project_file_upload` | `skippy:read + skippy:write` |
| `brief_task` | `skippy:read + skippy:write` |
| `cancel_task` | `skippy:read + skippy:write` |
| `capture` | `skippy:read + skippy:write` |
| `capture_thought` | `skippy:read + skippy:write` |
| `complete_interview` | `skippy:read + skippy:write` |
| `complete_recurrence` | `skippy:read + skippy:write` |
| `create_phase` | `skippy:read + skippy:write` |
| `create_project` | `skippy:read + skippy:write` |
| `create_task` | `skippy:read + skippy:write` |
| `dispatch_notifications` | `skippy:read + skippy:write` |
| `finalize_project_file_upload` | `skippy:read + skippy:write` |
| `generate_focus_summary` | `skippy:read + skippy:write` |
| `generate_project_file_upload_url` | `skippy:read + skippy:write` |
| `get_context_bundle` | `skippy:read` |
| `get_current_context` | `skippy:read + skippy:write` |
| `get_financial_report` | `skippy:read` |
| `get_importance_rubric` | `skippy:read` |
| `get_interview` | `skippy:read` |
| `get_memory_detail` | `skippy:read` |
| `get_project_file` | `skippy:read` |
| `get_project_file_manifest` | `skippy:read` |
| `get_project_notes` | `skippy:read` |
| `get_project_plan` | `skippy:read` |
| `get_skill` | `skippy:read` |
| `get_task_brief` | `skippy:read` |
| `ingest_object` | `skippy:read + skippy:write` |
| `link_entities` | `skippy:read + skippy:write` |
| `link_memory` | `skippy:read + skippy:write` |
| `list_agenda` | `skippy:read` |
| `list_interview_templates` | `skippy:read` |
| `list_interviews` | `skippy:read` |
| `list_life_tasks` | `skippy:read` |
| `list_memory` | `skippy:read` |
| `list_pending_actions` | `skippy:read` |
| `list_project_files` | `skippy:read` |
| `list_quick_captures` | `skippy:read` |
| `list_ready_tasks` | `skippy:read` |
| `list_recurrences` | `skippy:read` |
| `list_requested_ready_tasks` | `skippy:read` |
| `list_task_artifacts` | `skippy:read` |
| `list_tasks_by_state` | `skippy:read` |
| `mark_quick_capture_handled` | `skippy:read + skippy:write` |
| `mark_task_done` | `skippy:read + skippy:write` |
| `mark_task_in_progress` | `skippy:read + skippy:write` |
| `plan_project` | `skippy:read + skippy:write` |
| `propose_calendar_event` | `skippy:read + skippy:write` |
| `record_decision` | `skippy:read + skippy:write` |
| `record_entity_review` | `skippy:read + skippy:write` |
| `record_financial_balances` | `skippy:read + skippy:write` |
| `record_financial_transactions` | `skippy:read + skippy:write` |
| `record_ingestion_run` | `skippy:read + skippy:write` |
| `record_memory` | `skippy:read + skippy:write` |
| `record_pending_action_result` | `skippy:read + skippy:write` |
| `record_principle` | `skippy:read + skippy:write` |
| `record_task_result` | `skippy:read + skippy:write` |
| `refresh_focus_summary` | `skippy:read + skippy:write` |
| `register_project_file` | `skippy:read + skippy:write` |
| `set_task_phase` | `skippy:read + skippy:write` |
| `snapshot_project_notes` | `skippy:read + skippy:write` |
| `start_interview` | `skippy:read + skippy:write` |
| `submit_candidate_object` | `skippy:read + skippy:write` |
| `submit_memory_review_candidate` | `skippy:read + skippy:write` |
| `summarize_focus` | `skippy:read + skippy:write` |
| `update_link_status` | `skippy:read + skippy:write` |
| `update_phase` | `skippy:read + skippy:write` |
| `update_project` | `skippy:read + skippy:write` |
| `update_project_notes` | `skippy:read + skippy:write` |
| `update_source_sync_status` | `skippy:read + skippy:write` |
| `upsert_company` | `skippy:read + skippy:write` |
| `upsert_financial_account` | `skippy:read + skippy:write` |
| `upsert_goal` | `skippy:read + skippy:write` |
| `upsert_link` | `skippy:read + skippy:write` |
| `upsert_note` | `skippy:read + skippy:write` |
| `upsert_person` | `skippy:read + skippy:write` |
| `upsert_project` | `skippy:read + skippy:write` |
| `upsert_recurrence` | `skippy:read + skippy:write` |
| `upsert_task` | `skippy:read + skippy:write` |
