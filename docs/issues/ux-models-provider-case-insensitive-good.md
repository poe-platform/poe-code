---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:373-376 lowercases --provider and owned_by before substring match; positive note, no defect"
comment: "Positive pattern worth keeping alongside ux-models-feature-tools-case-insensitive-good.md rather than merging into the generic filter positives: together they establish that models is consistently case-insensitive across two independent filters, which makes ux-spawn-mode-case-sensitive.md a clear outlier rather than a matter of taste. Cite both from there."
---

# UX: models --provider is case-insensitive (positive)

## Summary

models --provider Anthropic --search sonnet works same as anthropic — case-insensitive provider filter.

## Evidence

--provider Anthropic → 2 sonnet models.

## Why it matters

Positive case handling (contrast mode AUTO).

## Suggested direction

Keep; apply to --mode.

## Severity

Low

## Area

Models / positive pattern
