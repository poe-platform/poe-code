---
severity: medium
impact: polish
comment: "Duplicate within the empty-table quintet (ralph variant); retire into ux-empty-plan-kind-lists-still-draw-empty-tables.md."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan list --kind ralph prints header row plus borders with zero rows and no empty-state message; renderPlanList src/cli/commands/plan.ts:394-414 always calls renderTable, and renderTableTerminal packages/toolcraft-design/src/components/table.ts:317-370 has no empty-rows branch"
---

# UX: empty ralph plan list still empty table (reconfirmed)

## Summary

plan list --kind ralph draws empty table borders without No ralph plans message.

## Evidence

empty table chrome only.

## Why it matters

Reconfirm empty kind table UX.

## Suggested direction

No-plans message + create hints.

## Severity

Medium

## Area

Plan list
