---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives. Retire into the consolidated note - a provider filter returning that provider's models is the baseline expectation, not a finding."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372-377 filters models by substring match on owned_by; positive note, no defect"
---

# UX: models --provider xai works (positive)

## Summary

models --provider xai lists grok models cleanly.

## Evidence

--provider xai → 10 models.

## Why it matters

Positive provider filter.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
