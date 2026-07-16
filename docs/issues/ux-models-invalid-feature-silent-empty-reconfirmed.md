---
severity: medium
impact: correctness
comment: "Reconfirm duplicate within the silent-filter-validation cluster; retire into ux-models-feature-bogus-silent-empty.md. Four files now report that --feature does not validate; one is enough."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:195-201 normalizeRequiredFilter only rejects empty values (no allow-list), so src/cli/commands/models.ts:392 hasFeature filters every model out for --feature bogus; duplicate of docs/issues/ux-models-feature-bogus-silent-empty.md"
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
