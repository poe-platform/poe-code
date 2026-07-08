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
