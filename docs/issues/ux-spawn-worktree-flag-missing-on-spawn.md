# UX: --worktree missing on spawn (present on gaslight/ralph/etc)

## Summary

spawn --worktree is unknown option; worktree exists on gaslight/ralph/pipeline/experiment — spawn users cannot use managed worktrees via spawn alone.

## Evidence

```bash
$ poe-code spawn claude "…" --mode read --worktree
error: unknown option '--worktree'
```
gaslight/ralph have --worktree.

## Why it matters

Inconsistent worktree support across agent runners.

## Suggested direction

Add --worktree to spawn or document spawn lacks it.

## Severity

**High**

## Area

Spawn / worktree
