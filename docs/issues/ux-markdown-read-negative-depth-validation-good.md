---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:161-175 parseNonNegativeInt rejects non-digit chars, so --depth -1 errors as described; positive note, no defect"
comment: "Positive pattern; another member of the numeric-validation positive family. Consolidate that family into one reference note. Mild tension worth resolving with ux-markdown-read-depth-zero-empty-sections.md: -1 is rejected as invalid while 0 is silently accepted and returns nothing, so the boundary is inconsistent."
---

# UX: plan markdown-read negative depth validation is good (positive)

## Summary

markdown-read --depth -1: Invalid depth "-1". Expected a non-negative integer.

## Evidence

Invalid depth "-1". Expected a non-negative integer.

## Why it matters

Positive validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
