# UX: Many parent groups only dump help with no default or next-step (expanded set)

## Summary

Beyond pipeline/experiment/ralph, bare invocations of skill, memory, provider, runtime, launch, worktree, utils, braintrust, and tasks only print help listings with no default action or onboarding next step. auth and usage are better defaults; these groups are not.

## Evidence

Bare: skill, memory, provider, runtime, launch, worktree, utils, braintrust, tasks → help only.
auth → status; usage → balance.

## Why it matters

First-run exploration of advanced surfaces stalls; expands group-commands-print-help-only issue with full list.

## Suggested direction

Per-group default or "Most common: …" next-step line; provider list, memory status, launch status, etc.

## Severity

Medium

## Area

First-run
