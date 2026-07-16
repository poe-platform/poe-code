---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:395-415 renderPlanList calls renderTable with no empty-rows guard; 'npm run dev -- plan list --kind experiment' printed header row plus borders only, no 'No experiment plans' message. Duplicate of ux-empty-plan-kind-lists-still-draw-empty-tables.md (already reproduced=y, recommendation=fix)"
comment: "One of five near-identical filings of the empty plan-list table, one per --kind value; retire into ux-empty-plan-kind-lists-still-draw-empty-tables.md, which already makes the coverage point. Filing the same renderer behavior once per enum value is the mechanical worst case of count inflation in this audit - five files, one fix, no added information."
---

# UX: empty experiment plan list still empty table (reconfirmed)

## Summary

plan list --kind experiment draws empty table without No experiment plans message.

## Evidence

empty table borders only.

## Why it matters

Reconfirm empty kind table UX.

## Suggested direction

No-plans message.

## Severity

Medium

## Area

Plan list
