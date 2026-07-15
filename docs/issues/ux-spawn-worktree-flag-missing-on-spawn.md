---
severity: high
impact: capability-gap
comment: "Third filing of the worktree parity gap; retire into ux-gaslight-has-worktree-spawn-does-not.md. Its list is the broadest (gaslight, ralph, pipeline, experiment all have it), which strengthens the case: spawn is the only runner without it, so the omission looks accidental rather than principled."
---

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
