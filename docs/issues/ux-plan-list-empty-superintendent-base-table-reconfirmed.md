---
severity: medium
impact: polish
comment: "Duplicate within the empty-table quintet (superintendent-base variant); retire into ux-empty-plan-kind-lists-still-draw-empty-tables.md."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:370-416 renderPlanList has no empty guard; `npm run dev -- plan list --kind superintendent-base` in empty dir printed header-only table with no 'No plans found.' (browser.ts:44-47 has the guard)"
---

# UX: empty superintendent-base list still empty table (reconfirmed)

## Summary

plan list --kind superintendent-base draws empty table chrome without No plans message.

## Evidence

empty table borders only.

## Why it matters

Reconfirm empty kind table UX.

## Suggested direction

No-plans message + create hints.

## Severity

Medium

## Area

Plan list
