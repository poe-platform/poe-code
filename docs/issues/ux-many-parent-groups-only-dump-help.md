---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/skill.ts:85 bare skill calls this.help(); provider.ts:40, launch.ts:42, worktree.ts:20, utils.ts:8, braintrust.ts:13, tasks.ts:56, runtime/index.ts register groups with no bare action (commander prints help), while auth.ts:13 defaults to executeStatus and usage.ts:172 to executeBalance"
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
