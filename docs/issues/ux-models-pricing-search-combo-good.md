---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models pricing/filter positives. Retire into the consolidated note. Its 'use in help examples' idea is already satisfied - ux-models-help-examples-are-excellent.md shows these compositions are in the Examples block."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:267,276,384,478 --search filter and pricing view compose; src/cli/commands/models.ts:303-305 help Examples already show filter+view combos. Positive note, no defect."
---

# UX: models --search + --view pricing combo works well (positive)

## Summary

models --search haiku --view pricing shows clean single-model pricing row.

## Evidence

```bash
$ poe-code models --search haiku --view pricing
●  1/341 models — pricing table for haiku
```

## Why it matters

Positive filter+view composition.

## Suggested direction

Keep; use in help examples.

## Severity

Low

## Area

Models / positive pattern
