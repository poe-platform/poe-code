---
severity: high
impact: usability
comment: "One of five filings of the same raw GitHub 401 across tasks get/next and maestro; consolidate into one issue about mapping GitHub auth failures to a UserError. All agree on the fix (name gh auth login or GITHUB_TOKEN, drop the raw JSON), so the cluster carries one decision and four repetitions."
reproduced: y
recommendation: no-fix
evidence: "packages/task-list/src/backends/gh-issues-client.ts:36 throws plain Error 'GitHub GraphQL request failed with status ${response.status}: ${body}'; src/cli/commands/tasks.ts:363 runGet opens the task list and its catch calls handleCommandError (tasks.ts:732) which prints error.message verbatim via writeError (tasks.ts:738); no 401/Bad credentials mapping exists in src/cli/errors.ts. Duplicate of ux-tasks-github-401-raw-json-reconfirmed.md cluster."
---

# UX: tasks get bad auth dumps raw GitHub 401 JSON (reconfirmed)

## Summary

tasks get missing --yes: GitHub GraphQL 401 Bad credentials raw JSON — reconfirm GitHub auth UX class.

## Evidence

GitHub GraphQL request failed with status 401: { "message": "Bad credentials" }

## Why it matters

Reconfirm UserError: gh auth login.

## Suggested direction

UserError without raw JSON.

## Severity

**High**

## Area

Tasks / GitHub
