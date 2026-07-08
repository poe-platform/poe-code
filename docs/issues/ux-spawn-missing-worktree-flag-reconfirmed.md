# UX: spawn missing --worktree flag (reconfirmed)

## Summary

spawn --worktree foo unknown option; worktree exists as separate command group; superintendent has --worktree.

## Evidence

spawn --help has no worktree; --worktree unknown option.

## Why it matters

Reconfirm unified --worktree on spawn platform fix.

## Suggested direction

Add spawn --worktree name integrating worktree package.

## Severity

**High**

## Area

Spawn / worktree
