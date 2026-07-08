# UX: worktree remove not found uses system chrome

## Summary

worktree remove no-such → Worktree not found in registry + See logs.

## Evidence

```bash
$ poe-code worktree remove no-such --yes
■  Error: Worktree "no-such" not found in registry
●  See logs …
```

## Why it matters

Not-found should be ValidationError without logs; suggest worktree list.

## Suggested direction

UserError + worktree list hint.

## Severity

Medium

## Area

Worktree
