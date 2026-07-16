---
severity: low
impact: none
comment: "Positive pattern; consolidate into the models filter-composition note. Its incidental check is the useful part - --since 1s returns 0 - showing the window arithmetic is honoured at the extremes, and it pairs with ux-models-since-1d-empty-today.md: a correct zero presented as a filter failure."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:423-426 applies cutoff = Date.now() - sinceDuration with m.created >= cutoff; tests src/cli/commands/models-command.test.ts:1058,1087,1106 cover filtering and the no-match message; invalid durations throw ValidationError at models.ts:187-191 (test:1077), so no defect exists"
---

# UX: models --since 7d works (positive)

## Summary

models --since 7d returns 2 recent models; --since 1s returns 0 with No models match — duration filter works.

## Evidence

--since 7d → 2/341; --since 1s → 0/341

## Why it matters

Positive --since filter.

## Suggested direction

Keep; still fix invalid --since stack dump.

## Severity

Low

## Area

Models / positive pattern
