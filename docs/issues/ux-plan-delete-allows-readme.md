---
severity: high
impact: data-loss
comment: "Contradicted by ux-plan-delete-json-skips-without-reason.md, which shows plan delete on README returns skipped:true and leaves the file present - so README may already be protected and this file's dry-run 'Would delete' may simply be the preview not modelling the guard (the same dry-run fidelity problem as ux-gaslight-install-force-dry-run-vs-already-exists.md). Resolve before scheduling. The concern is right regardless: deleting the plans index is catastrophic and should be explicitly refused rather than left to a confirmation."
---

# UX: plan delete will delete README.md meta files

## Summary

plan delete dry-run accepts docs/plans/README.md.

## Evidence

Would delete docs/plans/README.md

## Why it matters

Deleting plans index catastrophic.

## Suggested direction

Refuse non-plan basenames.

## Severity

**High**

## Area

Plan / destructive
