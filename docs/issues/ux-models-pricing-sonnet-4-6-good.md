---
severity: low
impact: none
comment: "Positive pattern; third duplicate of the pricing-view observation. Retire into the consolidated note. The concrete figures it records are the only durable detail and are transient anyway."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:478-500 implements the --view pricing table with Input/Output $/MTok and cache columns; positive note, no defect to reproduce."
---

# UX: models pricing for sonnet-4.6 is clear (positive)

## Summary

models --view pricing --model claude-sonnet-4.6 shows $2.58/$12.88 per MTok cleanly.

## Evidence

pricing table for anthropic/claude-sonnet-4.6.

## Why it matters

Positive pricing view.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
