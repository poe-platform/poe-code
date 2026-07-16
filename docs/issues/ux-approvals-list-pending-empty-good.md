---
severity: low
impact: none
comment: "Positive pattern, no code change; duplicate of ux-approvals-list-empty-good.md differing only by --state pending. Retire into that one."
reproduced: n
recommendation: no-fix
evidence: "packages/toolcraft/src/human-in-loop/approvals-commands.ts:218 renderApprovalList logs 'No approvals found.' when result.length === 0; --state pending shares this same empty branch, so this is a positive note with no defect"
---

# UX: approvals list --state pending empty is clear (positive)

## Summary

approvals list --state pending: No approvals found — clear empty state.

## Evidence

No approvals found.

## Why it matters

Positive empty approvals.

## Suggested direction

Keep.

## Severity

Low

## Area

Approvals / positive pattern
