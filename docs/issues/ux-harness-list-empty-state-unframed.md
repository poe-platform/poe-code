# UX: harness list empty state renders as bare bullet, not a panel

## Summary

`poe-code harness list` when no harnesses exist shows:

```
Poe - harness list
◆  No harness pairs found.
```

The "No harness pairs found." message appears as a raw bullet beneath the header — no panel border, no framing. This is the same empty-state rendering issue documented for `worktree list`.

## Why it matters

Looks incomplete. Same inconsistency as `worktree list` — two list commands share the same broken empty-state pattern vs. other commands that use bordered panels.

## Suggested direction

Wrap the empty-state message in a panel consistent with how other list commands render their empty state.

## Severity

Low

## Area

Harness / list / empty state / visual consistency
