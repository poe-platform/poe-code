---
severity: high
impact: usability
comment: "Keep as canonical of the tasks GitHub 401 cluster (clearest single repro plus the '[error]' prefix detail). The defect is real: a GraphQL payload dumped at the user is neither actionable nor recognisable as an auth problem. Its fix is right and should also cover maestro, which fails identically - one mapping at the GitHub client layer closes both."
reproduced: y
recommendation: fix
evidence: "packages/task-list/src/backends/gh-issues-client.ts:36 throws Error('GitHub GraphQL request failed with status ' + status + ': ' + body) embedding the raw response body; src/cli/commands/tasks.ts:747 formatCommandError returns error.message verbatim and writeError (line 738/744) emits it with an '[error]' prefix. No UserError/401 mapping exists in packages/task-list/src (rg found none)."
---

# UX: tasks get with bad GitHub auth dumps raw 401 JSON

## Summary

tasks get missing-id fails with raw GitHub GraphQL 401 JSON Bad credentials — unframed auth error.

## Evidence

```bash
$ poe-code tasks get missing-id
■  [error] GitHub GraphQL request failed with status 401: { "message": "Bad credentials", …}
```

## Why it matters

Users need gh auth login next step not raw GraphQL.

## Suggested direction

UserError: GitHub auth failed. Run gh auth login; no raw JSON.

## Severity

**High**

## Area

Tasks / GitHub
