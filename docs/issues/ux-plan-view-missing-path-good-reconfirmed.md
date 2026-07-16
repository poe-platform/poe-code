---
severity: low
impact: none
comment: "Reconfirm duplicate of ux-plan-view-missing-path-good.md; retire. The pair is worth one note as the in-group reference: plan view's 'Plan not found' is clean and log-free, which is exactly what markdown-read's equivalent is not (ux-plan-view-vs-markdown-read-not-found-inconsistent.md)."
reproduced: n
recommendation: no-fix
evidence: "Positive/no-defect note and duplicate of docs/issues/ux-plan-view-missing-path-good.md. Behaviour confirmed intact: src/cli/commands/plan.ts:320 throws ValidationError('Plan not found: ...'); src/cli/errors.ts ValidationError extends CliError with isUserError true, so src/cli/bootstrap.ts:71-77 logs the bare message and skips the 'See logs at .../errors.log' hint. No defect to fix."
---

# UX: plan view missing path is clear (reconfirmed positive)

## Summary

plan view /tmp/no-plan.md: Plan not found — clear without See logs.

## Evidence

■  Plan not found: /tmp/no-plan.md

## Why it matters

Positive missing path ValidationError.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
