---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:398-403 defines Kind/Type/Name/Detail/Updated columns; packages/toolcraft-design/src/components/table.ts:377-396 renderTableMarkdown emits GFM header/separator/rows - positive note, no defect"
comment: "Positive pattern: a GFM table is a genuinely useful export for pasting into docs or PRs, and a capability most commands lack. Its caveat is the README noise, which belongs to ux-plan-list-includes-readme-reconfirmed.md. Consolidate with ux-plan-list-pipeline-json-good.md into one note that plan list's output modes are its strength."
---

# UX: plan list --output md is clean markdown table (positive)

## Summary

plan list --output md prints GFM table with Kind/Type/Name/Detail/Updated — good export (still includes README.md).

## Evidence

plan list --output md → markdown table rows.

## Why it matters

Positive md export.

## Suggested direction

Keep; filter README.

## Severity

Low

## Area

Plan list / positive pattern
