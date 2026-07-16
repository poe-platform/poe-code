---
severity: low
impact: none
comment: "Valuable positive: 'No entries match \"nonexistent-model-xyz\"' echoes the filter back, precisely what the models silent-empty cluster fails to do - models returns 0/341 with no indication the filter was the problem. Cite it from ux-models-feature-bogus-silent-empty.md as the in-product template; its own suggestion says the same."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/usage.ts:378-380 emits 'No entries match \"${filterTerm}\".' when filterTerm set and totalFiltered===0; covered by usage-command.test.ts:1176-1201 - positive note, no defect"
---

# UX: usage list no-match filter message is good (positive)

## Summary

usage list --filter nonexistent-model-xyz → No entries match "…" — clear empty filter message.

## Evidence

No entries match "nonexistent-model-xyz".

## Why it matters

Positive empty filter UX.

## Suggested direction

Keep; apply to models empty filters.

## Severity

Low

## Area

Usage / positive pattern
