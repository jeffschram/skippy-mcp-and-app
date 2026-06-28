This file contains notes and todo issues for features and updates to be added.

## Current webapp page

Save a global state variable in the webapp with information about the current page opened. Then in the harness I can ask something like "Add a task to this project" and it would know which project Im talking about

## Code Projects

If a project is software/code it has an associated github repo and local folder.
If the Agent is assigned a task we need the agent to

- create a new local branch in the local repo
- do the work
- commit and make a PR to the repo
- update the task progress to 'in review'
- add the PR URL to the task
- when user approves/merges the PR the task is set to DONE

## Project Tasks

Briefed tasks should have an editable Execution brief and Acceptance Criteria in the web app
I don't think we need the 'Record result (supervise)' section in a briefed task
Currently the CTA for a Briefed task is 'Start' but it should be 'Mark Ready' and promoted to the Ready level

## All Projects

Should have a local folder filepath to save output files/assets

## Project Task UI in Webapp

Kanban board should allow user to move tasks to different states "Briefed" to "Ready" etc
