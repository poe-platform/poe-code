---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-models-pricing-search-combo-good.md and ux-models-pricing-sonnet-4-6-good.md - the same pricing view filed three times with different filters. Retire into the consolidated note."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: src/cli/commands/models.ts:384-390 applies --search filter and src/cli/commands/models.ts:478-498 renders the pricing table; filters compose independently as described."
---

# UX: models --view pricing --search haiku works (positive)

## Summary

models --view pricing --search haiku and --model claude-haiku-4.5 show clear pricing table.

## Evidence

haiku pricing $0.86/$4.29 per MTok.

## Why it matters

Positive pricing+filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
