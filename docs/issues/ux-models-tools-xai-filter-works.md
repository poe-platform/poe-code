---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives. Retire into the consolidated note."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372-373 provider filter and :408-409 --tools filter compose cumulatively on `filtered`; positive note, no defect"
---

# UX: models --tools --provider xai works (positive)

## Summary

models --tools --provider xai returns 9 xai tool models including grok-4 and code-fast-1.

## Evidence

9/341 xai tools models.

## Why it matters

Positive --tools shorthand + provider filter.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
