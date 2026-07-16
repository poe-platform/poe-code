---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:657-660 - empty pairs logs 'No harness pairs found.' and returns before renderTable; positive note, no defect"
comment: "One of three near-identical filings about the same harness list empty state - two positives and one calling it unframed. Consolidate; ux-harness-list-empty-state-unframed.md is the one with an actual ask. Its 'suggest harness new' idea is the useful residue and matters more than framing here, given the kinds are undiscoverable (ux-harness-new-kinds-undocumented-must-guess-demo-names.md)."
---

# UX: harness list empty is clear (positive)

## Summary

harness list: No harness pairs found — clear empty state.

## Evidence

●  No harness pairs found.

## Why it matters

Positive empty list.

## Suggested direction

Keep; suggest harness new.

## Severity

Low

## Area

Harness / positive pattern
