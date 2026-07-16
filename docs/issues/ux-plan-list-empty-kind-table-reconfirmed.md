---
severity: medium
impact: polish
comment: "Duplicate within the empty-table quintet (superintendent variant); retire into ux-empty-plan-kind-lists-still-draw-empty-tables.md."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan list --kind superintendent printed header-only table chrome with no rows; src/cli/commands/plan.ts:401 renderPlanList has no empty-state branch and packages/toolcraft-design/src/components/table.ts:381 always emits borders"
---

# UX: empty plan kind list still draws empty table (reconfirmed)

## Summary

plan list --kind superintendent draws empty table chrome without No plans message — reconfirm.

## Evidence

empty table borders only for superintendent kind.

## Why it matters

Reconfirm empty state UX.

## Suggested direction

No-plans message + create hints.

## Severity

Medium

## Area

Plan list
