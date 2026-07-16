---
severity: medium
impact: usability
comment: "Contentless ('plan question bare 400.') and most likely a symptom of the dead sonnet-5 default rather than a plan defect - a bare 400 is what the model failure looks like everywhere else in this audit. Retire into the sonnet-5 cluster and ux-user-errors-look-like-system-failures.md; re-check after the constants fix."
reproduced: n
recommendation: no-fix
evidence: "plan.ts non-TTY guards throw clean ValidationError (src/cli/commands/plan.ts:846,879); any 400 originates in the spawned agent CLI passed through raw (plan.ts:962-969) due to dead sonnet-5 alias (src/cli/constants.ts:3,14) - no plan-specific defect found"
---

# UX: plan non-TTY bare API error

## Summary

plan question bare 400.

## Evidence

plan how….

## Why it matters

Featured command poor.

## Suggested direction

Design-system wrap.

## Severity

Medium

## Area

Plan
