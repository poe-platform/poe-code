---
severity: medium
impact: usability
comment: "Duplicate within the worktree not-found chrome cluster; retire into ux-user-errors-look-like-system-failures.md. Its 'suggest worktree list' recovery is the useful residue."
reproduced: y
recommendation: fix
evidence: "packages/worktree/src/remove.ts:18 throws plain Error('Worktree \"<name>\" not found in registry'); src/sdk/worktree.ts:329 removeManagedWorktree calls it unwrapped, so src/cli/bootstrap.ts:71-80 takes the non-CliError branch and appends 'See logs at .../errors.log'"
---

# UX: worktree remove missing name has See logs

## Summary

worktree remove no-such-wt --yes: Worktree not found in registry + See logs — clear message, system chrome residual.

## Evidence

Error: Worktree "no-such-wt" not found in registry
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; suggest worktree list.

## Severity

Medium

## Area

Worktree
