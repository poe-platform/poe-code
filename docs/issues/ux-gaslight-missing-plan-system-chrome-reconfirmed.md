---
severity: medium
impact: usability
comment: "Another instance of the systemic UserError-vs-system-chrome issue: the message ('Plan file not found') is already right and only the 'See logs' tease is wrong. Retire into ux-user-errors-look-like-system-failures.md; the gaslight-specific residue is just the 'suggest gaslight install' recovery."
---

# UX: gaslight missing plan still system chrome (reconfirmed)

## Summary

gaslight /tmp/missing.yaml: Plan file not found + See logs — reconfirm ValidationError gap.

## Evidence

gaslight missing file → Plan file not found + See logs.

## Why it matters

Reconfirm UserError for missing plan.

## Suggested direction

ValidationError without logs; suggest gaslight install.

## Severity

Medium

## Area

Gaslight
