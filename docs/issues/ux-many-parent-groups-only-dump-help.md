---
severity: medium
impact: discoverability
comment: "Keep as canonical of the bare-group family and retire ux-group-commands-print-help-only.md into it: this enumerates the full set (skill, memory, provider, runtime, launch, worktree, utils, braintrust, tasks) and, more usefully, names the in-product counterexamples - auth defaults to status, usage to balance. That turns the ask from a design question into propagating an existing convention. Its 'Most common: ...' next-step line is a cheap alternative where a default action would be presumptuous."
---

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
