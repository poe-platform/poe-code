---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-plan-archive-json-output-good.md - same JSON contract on the sibling command. Consolidate. Note its evidence deletes README.md and restores it via git: the audit's own positive probe destroyed the plans index, which is the strongest argument for the explicit refusal that ux-plan-delete-allows-readme.md asks for."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:515 emits JSON.stringify({ action: 'delete', path: plan.path }) under --output json; positive note, no defect to reproduce"
---

# UX: plan delete --output json is clean machine shape (positive)

## Summary

plan delete path --yes --output json returns action/path — good machine contract (restored file after audit).

## Evidence

{"action":"delete","path":"docs/plans/README.md"}

## Why it matters

Positive JSON destructive result.

## Suggested direction

Keep; document --yes; help still omits --yes.

## Severity

Low

## Area

Plan / positive pattern
