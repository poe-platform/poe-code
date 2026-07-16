---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:395-415 renderPlanList calls renderTable with no empty-rows guard; 'npm run dev -- plan list --kind experiment' printed header plus borders only, no 'No plans' message"
comment: "Member of the empty-table cluster. Its contribution is coverage - the behavior repeats across every --kind - which argues the fix belongs in the shared table/empty-state renderer rather than per kind. Retire the four per-kind reconfirms into this one and keep ux-plan-list-empty-table-no-message.md as the general statement."
---

# UX: Empty plan kind filters still draw empty table chrome

## Summary

plan list --kind experiment|ralph|superintendent draws full empty table borders with no "No plans" message (extends empty plan list issue across kinds).

## Evidence

plan list --kind experiment → empty table frame only.

## Why it matters

Looks like a rendering bug for empty filters.

## Suggested direction

No-plans message + create/install hints per kind.

## Severity

Medium

## Area

Plan list
