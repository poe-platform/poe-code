---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/worktree.ts:40-45 remove registers only <name> and --delete-branch; -y/--yes is program-level only (src/cli/program.ts:852); executeWorktreeRemove calls removeManagedWorktree with no confirmation guard. Duplicate of ux-worktree-remove-help-omits-yes.md."
comment: "One of two filings of the worktree remove help gap; consolidate into ux-worktree-remove-help-omits-yes.md, which pairs it with the not-found chrome. The concern is fair - remove destroys a worktree, which may contain uncommitted work - so the confirmation policy belongs in help. Verify the guard exists before rating, per the memory clear lesson."
---

# UX: worktree remove help omits --yes confirmation policy

## Summary

worktree remove --help has --delete-branch but no --yes / confirmation notes for destructive remove.

## Evidence

worktree remove help: name, --delete-branch, -h only.

## Why it matters

Destructive command help incomplete.

## Suggested direction

Document confirmation; require --yes non-TTY.

## Severity

Medium

## Area

Worktree
