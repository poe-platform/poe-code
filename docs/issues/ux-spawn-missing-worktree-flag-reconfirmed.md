---
severity: high
impact: capability-gap
comment: "Duplicate within the worktree parity trio; retire into ux-gaslight-has-worktree-spawn-does-not.md, which proves the capability exists on a sibling command. Its extra data point is useful: superintendent has --worktree too, so spawn is the outlier among three commands rather than one."
---

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
