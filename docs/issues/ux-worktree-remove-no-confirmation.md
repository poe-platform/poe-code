---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/worktree.ts:38-45 registers 'worktree remove' with only --delete-branch; executeWorktreeRemove (lines 83-102) calls removeManagedWorktree immediately; rg 'confirm' in worktree.ts, shared.ts, sdk/worktree.ts, packages/worktree/src/remove.ts returns no matches"
comment: "Contentless and inferred from help rather than tested ('Evidence: worktree remove help') - the same method that produced false claims in ux-memory-clear-no-yes-no-dry-run.md and ux-provider-logout-no-confirmation.md. Do not schedule until someone runs it; ux-worktree-remove-help-omits-yes.md shows --yes is at least accepted, hinting a guard exists. Its 'work loss' concern is legitimate if true - a worktree can hold uncommitted changes."
---

# UX: worktree remove no confirmation

## Summary

Destructive no confirm.

## Evidence

worktree remove help.

## Why it matters

Work loss.

## Suggested direction

Confirm/--yes.

## Severity

Medium

## Area

Worktree
