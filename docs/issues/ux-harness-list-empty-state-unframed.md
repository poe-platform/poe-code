---
severity: low
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:658 logger.info('No harness pairs found.') renders a bare bullet, but every other list empty state does the same: worktree.ts:54, launch.ts:143, models.ts:367, usage.ts:377, pipeline.ts:1187, skill.ts:413. No list command panels its empty state, so the claimed inconsistency does not exist."
comment: "Keep as the one with an actionable ask, but note it directly contradicts the two positives praising this same output - and the contradiction is informative: plan list is criticised for drawing a bordered empty table while harness list is criticised for not drawing a panel. Both cannot be right. Settle the empty-state convention once (ux-worktree-list-empty-state-unframed.md reports the same for worktree) and apply it everywhere."
---

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
