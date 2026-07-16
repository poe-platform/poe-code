---
severity: medium
impact: usability
comment: "Contentless duplicate within the GitHub 401 cluster; retire. Its 'wrong auth surface' framing is the sharpest three words in the cluster: poe-code's own auth is fine, the failure is GitHub's, and nothing in the message tells users which credential system to fix."
reproduced: y
recommendation: no-fix
evidence: "packages/task-list/src/backends/gh-issues-client.ts:36 throws plain Error 'GitHub GraphQL request failed with status ${response.status}: ${body}' embedding the raw 401 body; src/cli/commands/tasks.ts:363 runGet's catch calls handleCommandError (tasks.ts:732) whose formatCommandError (tasks.ts:747) returns error.message verbatim, printed as '[error] <raw>' by writeError (tasks.ts:744). No 401/auth mapping exists in packages/task-list/src. Behaviour real but duplicate; canonical is ux-tasks-get-github-401-raw-json.md (MASTER.md:299)."
---

# UX: tasks GitHub 401 raw JSON

## Summary

tasks get raw GraphQL 401.

## Evidence

tasks get abc.

## Why it matters

Wrong auth surface.

## Suggested direction

User error + gh auth.

## Severity

Medium

## Area

Tasks / auth
