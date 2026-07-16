---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives. Retire into the consolidated note."
reproduced: n
recommendation: no-fix
evidence: "No defect - positive note confirmed working; src/cli/commands/models.ts:130-132 hasFeature checks supported_features, applied at models.ts:391-392; probe 'npm run dev -- models --provider anthropic --feature web_search' returned 8/344 models all with web_search checked"
---

# UX: models --feature web_search works (positive)

## Summary

models --provider anthropic --feature web_search returns models with web_search ✓.

## Evidence

anthropic models with web_search filter → 8 models.

## Why it matters

Positive feature filter.

## Suggested direction

Keep; validate feature names.

## Severity

Low

## Area

Models / positive pattern
