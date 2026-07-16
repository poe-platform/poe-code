---
severity: high
impact: usability
comment: "Fourth filing within the tasks GitHub 401 cluster (next instead of get); retire into ux-tasks-get-github-401-raw-json.md. Coverage only - though it does confirm the failure is in the shared GitHub client rather than one subcommand, which supports fixing it there."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/tasks.ts:511 runNext calls openConfiguredTaskList, whose gh backend hits packages/task-list/src/backends/gh-issues-client.ts:36 throwing plain Error 'GitHub GraphQL request failed with status ${response.status}: ${body}' with the raw body; tasks.ts:548 handleCommandError -> formatCommandError (tasks.ts:747) returns error.message verbatim; no 401/Bad credentials mapping exists (only the missing-token AUTH_ERROR at gh-issues-client.ts:6). Duplicate of ux-tasks-get-github-401-raw-json.md cluster."
---

# UX: tasks next with bad auth dumps raw GitHub 401 JSON

## Summary

tasks next some-id --yes fails with raw GraphQL 401 Bad credentials — unframed auth error.

## Evidence

GitHub GraphQL request failed with status 401: { "message": "Bad credentials" }

## Why it matters

Users need gh auth login next step.

## Suggested direction

UserError: GitHub auth failed. Run gh auth login.

## Severity

**High**

## Area

Tasks / GitHub
