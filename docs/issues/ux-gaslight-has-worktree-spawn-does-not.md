# UX: gaslight has --worktree but spawn does not

## Summary

gaslight --help lists --worktree; spawn --worktree unknown — inconsistent worktree surface.

## Evidence

gaslight: --worktree Run in a managed git worktree…
spawn: unknown option --worktree

## Why it matters

Reconfirm unified --worktree on spawn.

## Suggested direction

Parity: spawn --worktree same as gaslight/superintendent.

## Severity

**High**

## Area

Spawn / worktree
