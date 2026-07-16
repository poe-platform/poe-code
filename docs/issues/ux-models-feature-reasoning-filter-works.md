---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives - consolidate. Its parenthetical is the useful half and recurs across the family: the filter works when the name is valid and fails silently when it is not (ux-models-feature-bogus-silent-empty.md), so the positives and that defect are two halves of one story."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:130-132 hasFeature maps reasoning to model.reasoning; :391-392 applies filter; :528 renders Reasoning checkmark - positive note, no defect"
---

# UX: models --feature reasoning works (positive)

## Summary

models --feature reasoning --provider anthropic returns reasoning-capable models with ✓ in Reasoning column.

## Evidence

models --feature reasoning --provider anthropic → 8 models with Reasoning ✓

## Why it matters

Positive feature filter when name is valid (contrast bogus silent empty).

## Suggested direction

Keep; validate feature names.

## Severity

Low

## Area

Models / positive pattern
