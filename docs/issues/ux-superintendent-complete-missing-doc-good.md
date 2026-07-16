---
severity: low
impact: none
comment: "Positive pattern whose value is comparative: 'Superintendent document not found' is correct for a missing path, which is exactly what makes the wrong-kind case's 'Unclosed tag' error (ux-superintendent-validate-wrong-kind-unclosed-tag.md) so clearly wrong. Keep as the control case for that fix."
reproduced: n
recommendation: no-fix
evidence: "packages/superintendent/src/commands/complete.ts:75,90 map ENOENT to UserError 'Superintendent document not found: <path>'; complete.test.ts:242 asserts it. Positive note, no defect."
---

# UX: superintendent complete missing doc is clear (positive)

## Summary

superintendent complete /tmp/no.md: Superintendent document not found — clear (better than Unclosed tag on wrong kind).

## Evidence

■  Superintendent document not found: /tmp/no.md

## Why it matters

Positive missing path for complete.

## Suggested direction

Keep; wrong-kind still Unclosed tag separately.

## Severity

Low

## Area

Superintendent / positive pattern
