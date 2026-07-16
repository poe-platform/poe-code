---
severity: low
impact: none
comment: "Positive pattern; duplicate within the models filter-composition positives. Retire into the consolidated note."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372-392 composes --provider substring filter then --feature filter; positive note, no defect"
---

# UX: models --feature tools --provider anthropic works (positive)

## Summary

models --feature tools --provider anthropic returns 8 anthropic tool models including sonnet-4.6 and opus-4.7/4.8.

## Evidence

8/341 anthropic tools models listed.

## Why it matters

Positive multi-filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
