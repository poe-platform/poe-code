---
severity: low
impact: none
comment: "Positive pattern, no code change; near-duplicate of ux-approvals-list-pending-empty-good.md (same string, one adds --state pending). Consolidate the pair. Worth resolving the tension with ux-approvals-invalid-state-silent-empty-reconfirmed.md: this praises 'No approvals found' as a clear empty state, while that file shows the same string is what makes an invalid filter undetectable. The message is fine; the missing input validation is the defect."
reproduced: n
recommendation: no-fix
evidence: "packages/toolcraft/src/human-in-loop/approvals-commands.ts:218 renderApprovalList logs 'No approvals found.' when result.length === 0; positive note, no defect"
---

# UX: approvals list empty is clear (positive)

## Summary

approvals list: No approvals found — clear empty state.

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
