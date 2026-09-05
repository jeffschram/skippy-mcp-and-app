Surface a 'Why this was saved' in cards etc



## Decision Rubric

A combination of 
- editable The Rubric in Settings
- active goals
- in-progress projects
- favorited contacts

## Settings > Activity Logs 
Should probably be in BRAIN

## About page
Retire


## Agenda
- we need a way to delete Events

Agenda items 'areas':
- work
- personal
- household
- health
- finance
- social
- errand

Agenda items are
- Real gcal event  : Calendar mirror table
- task with due date: tasks table
- Recurring thing: Recurrences table

TODO: add areas to Events


## Review

### Signals
The 'maybe this is important' pile based on importance rubric
- plain check: save it as proposed
- circle check: save it after I changed things
- shuffle: if I picked a different target type like 'Task' 
- link: merges it if i use 'merge target'
## Actions
Skippy wants to do something in the real world: approve? - for gcal

## Routines
Confirm what's sorta stale, is this still true/worth keeping?



# Brain Types
- goal
- project
- task
- note
	- title and body
- person
- company
- link
- knowledgeObject
	- structured facts about a thing
		- objectType "free text descriptor"
		- title
		- summary
		- properties "open key/values"

Brain Type: Memory

- **Identity**
    
    - `brainInstanceId` — which brain it belongs to (you have one)
- **Content**
    
    - `memoryType` — one of 7 kinds:
        - `memory` — a durable fact or preference
        - `decision` — a choice that was made
        - `principle` — an operating rule
        - `thought` — a raw captured thought
        - `question` — an open question
        - `insight` — a realization
        - `artifact` — a produced thing worth remembering
    - `title` — short label _(required)_
    - `summary` — optional one-liner
    - `body` — the full text of the memory _(required)_
- **Lifecycle**
    
    - `status` — which shelf it's on:
        - `inbox` — waiting in Brain Inbox
        - `accepted` — live; agents use it
        - `rejected` — turned down
        - `archived` — retired
    - `reviewState` — where it is in the review workflow:
        - `unreviewed` · `pending_review` · `accepted` · `rejected` · `archived`
- **Trust & provenance**
    
    - `confidence` — 0–1, how sure the agent was
    - `sourceRefIds` — pointers to the source email/text/event it came from
    - `relatedEntityRefs` — links to other entities (project, person, goal…), each as `{ entityType, entityId }`
    - `rubricDecision` — one line: why it cleared the memory rubric
    - `captureReason` — why the agent grabbed it
- **Audit trail**
    
    - `reviewedBy` / `reviewedAt` — who reviewed it, when
    - `acceptedAt`
    - `rejectedAt` / `rejectionReason`
    - `archivedAt` / `archiveReason`
    - `createdAt` / `updatedAt` — timestamps (epoch ms)


## new: knowledge
- replaces
	- notes
	- links
	- knowledgeObjects
	- memories

## goal
## project
## task

## recurrence
I 