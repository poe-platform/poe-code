---
severity: medium
impact: polish
comment: "One of four filings of the bare code-review profiles table. Keep as canonical for the defect view (Medium; names both the missing panel and the npm run dev help) and retire the other three - but reconcile with ux-code-review-profiles-bare-table-good.md first, which calls the same output acceptable."
---

# UX: code-review profiles is bare table without design-system panel

## Summary

code-review profiles prints bare name/source table (generic built-in) without Poe - code-review panel framing; help uses npm run dev.

## Evidence

code-review profiles → bare ASCII table only.

## Why it matters

Inconsistent with design-system list commands.

## Suggested direction

Use design-system table panel; displayBinaryName.

## Severity

Medium

## Area

Code-review
