---
severity: low
impact: none
comment: "Keep of this pair as the reference case; retire the reconfirm. Its value is entirely comparative - it is the control proving the inconsistency in ux-plan-view-vs-markdown-read-not-found-inconsistent.md is a defect in markdown-read rather than an unavoidable limitation."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:320 throws ValidationError('Plan not found: <path>'); src/cli/errors.ts:70-72 marks it isUserError, so src/cli/bootstrap.ts:71-73 logs the bare message with no 'Error:' prefix or 'See logs' line"
---

# UX: plan view missing path is clear (positive)

## Summary

plan view /tmp/no-plan.md: Plan not found: path — clear without See logs.

## Evidence

■  Plan not found: /tmp/no-plan.md

## Why it matters

Positive missing-path ValidationError.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
