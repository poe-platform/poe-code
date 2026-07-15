---
severity: medium
impact: correctness
comment: "Reconfirm duplicate within the silent-filter-validation cluster; retire into ux-models-feature-bogus-silent-empty.md. Four files now report that --feature does not validate; one is enough."
---

# UX: models --feature bogus silently empties (reconfirmed)

## Summary

models --feature bogus → 0/341 No models match — no error that feature is invalid (related invalid modality silent empty).

## Evidence

--feature bogus → empty filter, no Expected tools|web_search|reasoning.

## Why it matters

Reconfirm invalid filter values should ValidationError.

## Suggested direction

Reject unknown features with allow-list.

## Severity

Medium

## Area

Models
