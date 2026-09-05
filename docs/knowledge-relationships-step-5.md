# Knowledge relationship migration step 5

The `relationships` table is now canonical for connections from unified
`knowledge` rows. New memory writes create `mentions` edges and knowledge reads
hydrate their related entities from those edges. The embedded
`knowledge.relatedEntityRefs` field has been removed from the schema.

After deploying the migration function, start the resumable backfill with a
bounded page:

```sh
npx convex run knowledge:backfillKnowledgeRelationships '{"paginationOpts":{"cursor":null,"numItems":100}}'
```

Each page schedules its continuation. The job is safe to rerun: it preserves
existing `mentions` edges, deduplicates endpoints, creates only missing edges,
and clears the legacy field after its edges exist. Edges created from legacy
refs use `createdBy: "system"` and retain the knowledge row's `updatedAt` as
their timestamp.

Knowledge kinds continue to use their public semantic entity types as graph
endpoints (`note`, `link`, and `knowledgeObject`). Memory rows use
`knowledgeObject`, since `memory` is intentionally not part of the public
entity-type/rubric union.
