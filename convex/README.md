# Convex backend

This directory contains Skippy's canonical backend schema and early functions.

Current backend surface:

- `schema.ts`: core typed tables, generic objects, relationships, source refs, triage, focus summaries, pending actions, activity, config, tokens, and AI/embedding metadata.
- `bootstrap.ts`: first-login style user/default-brain bootstrap helper.
- `knowledge.ts`: candidate submission, triage review, task completion, focus and pending-action queries.

Generated Convex files are intentionally not checked in yet. Run Convex codegen/dev once a deployment is configured.
