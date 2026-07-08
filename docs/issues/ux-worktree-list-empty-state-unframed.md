# UX: worktree list empty state renders as bare bullet, not a panel

## Summary

`poe-code worktree list` when no worktrees exist shows:

```
Poe - worktree list
◆  No managed worktrees.
```

The "No managed worktrees." message appears as a raw pink dot bullet beneath the header — with no panel border, no spacing, and no framing. Other commands that have empty states (e.g. `runtime jobs ls`, `plan list`) render the message inside a consistent bordered panel.

## Why it matters

The empty state looks incomplete — like the UI rendering broke mid-output. Users may wait for more content, or assume the command failed silently.

## Suggested direction

Wrap the empty-state message in a panel consistent with how other list commands render their empty state.

## Severity

Low

## Area

Worktree / list / empty state / visual consistency
