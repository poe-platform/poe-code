---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "packages/plan-browser/src/format.ts:327-357 formatPipelinePlanMarkdown emits '# title', 'Status: ...', '## Tasks', '- [x] ...'; src/cli/commands/plan.ts:650 returns raw markdown for --output md. Positive note, no defect."
comment: "Positive pattern; consolidate with the other plan list/view export positives into one note that these output modes are the plan group's strength. Its detail is genuinely useful though: --output md renders a pipeline as a markdown checklist with status, a natural PR/issue artefact worth documenting rather than merely keeping."
---

# UX: plan view pipeline --output md is readable (positive)

## Summary

plan view on pipeline plan with --output md produces markdown checklist Status 21/21 done with tasks — good export format.

## Evidence

plan view …hardening.md --output md → # title, Status, ## Tasks with [x] items.

## Why it matters

Positive md export for pipelines.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
