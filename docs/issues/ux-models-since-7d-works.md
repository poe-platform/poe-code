---
severity: low
impact: none
comment: "Positive pattern; consolidate into the models filter-composition note. Its incidental check is the useful part - --since 1s returns 0 - showing the window arithmetic is honoured at the extremes, and it pairs with ux-models-since-1d-empty-today.md: a correct zero presented as a filter failure."
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
