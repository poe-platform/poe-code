---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives. Retire into the consolidated note."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372-392 provider and feature filters chain as AND; hasFeature line 131 maps reasoning to model.reasoning != null. No defect described."
---

# UX: models --feature reasoning --provider xai works (positive)

## Summary

models --feature reasoning --provider xai returns xai/grok-3-mini — multi-filter works.

## Evidence

1/341 xai/grok-3-mini with reasoning

## Why it matters

Positive filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
