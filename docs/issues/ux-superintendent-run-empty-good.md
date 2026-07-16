---
severity: low
impact: none
comment: "Positive pattern, though it uses an error glyph for an empty state. Its 'suggest superintendent install/plan-path' residue is the useful half and is the same gap as the harness and eval empty states - the message is accurate and terminal. Consolidate into the empty-state convention work."
reproduced: n
recommendation: no-fix
evidence: "packages/superintendent/src/commands/run.ts:1215 throws UserError('No superintendent documents found.') when discoverPlans returns zero docs; message accurate and terminal, so no defect - positive note only"
---

# UX: superintendent run with no docs is clear (positive)

## Summary

superintendent run --yes: No superintendent documents found — clear empty state.

## Evidence

■  No superintendent documents found.

## Why it matters

Positive empty superintendent message.

## Suggested direction

Keep; suggest superintendent install/plan-path.

## Severity

Low

## Area

Superintendent / positive pattern
