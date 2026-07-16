---
severity: high
impact: usability
comment: "Reconfirm duplicate within the GitHub 401 cluster; retire. Its 'secrets-adjacent noise' note is worth a glance though: raw API error payloads can echo request context, so redaction is worth checking while mapping the error - the same concern as the dry-run secrets cluster."
reproduced: y
recommendation: no-fix
evidence: "packages/task-list/src/backends/gh-issues-client.ts:36 throws plain Error 'GitHub GraphQL request failed with status ${response.status}: ${body}' with the raw body; src/cli/commands/tasks.ts:363,402 (get/next) open the gh task list and src/cli/commands/tasks.ts:747 formatCommandError returns error.message unchanged, printed as '[error] <raw>' at line 744; no 401/auth mapping exists in src/cli/errors.ts. Behaviour real but duplicate of ux-tasks-get-github-401-raw-json.md cluster."
---

# UX: tasks GitHub 401 still dumps raw GraphQL JSON (reconfirmed)

## Summary

tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json } — reconfirm of tasks-github-auth-raw-error.

## Evidence

```bash
$ poe-code tasks get 123
■  [error] GitHub GraphQL request failed with status 401: { "message": "Bad credentials", … }
```

## Why it matters

Unusable recovery; secrets-adjacent noise.

## Suggested direction

UserError: GitHub auth required. Run gh auth login or set GITHUB_TOKEN.

## Severity

**High**

## Area

Tasks
