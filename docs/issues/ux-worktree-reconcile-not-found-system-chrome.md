# UX: worktree reconcile not found uses system chrome

## Summary

Worktree "missing" not found in registry + See logs — same as remove not-found.

## Evidence

```bash
$ poe-code worktree reconcile missing --agent claude
■  Error: Worktree "missing" not found in registry
●  See logs …
```

## Why it matters

Consistent not-found chrome cluster.

## Suggested direction

UserError + worktree list hint.

## Severity

Medium

## Area

Worktree
