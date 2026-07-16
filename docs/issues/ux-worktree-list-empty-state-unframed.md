---
severity: low
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/worktree.ts:54 prints resources.logger.info('No managed worktrees.') with no panel; same plain-info empty state in harness.ts, usage.ts, models.ts, launch.ts, pipeline.ts, runtime/templates/clear.ts; zero logger.outro calls in src/cli/commands, so the cited bordered-panel standard does not exist (only runtime/jobs/ls.ts renders an empty table, itself filed as a defect)"
comment: "Keep of this pair as the one with an ask, but note its premise is questionable: it claims plan list renders empty states inside a bordered panel and cites that as the standard, while ux-plan-list-empty-table-no-message.md files that same plan list behavior as a defect. So it argues toward the pattern another filing calls broken. Settle the convention first (ux-harness-list-empty-state-unframed.md reports the identical complaint for harness), then apply it once."
---

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
