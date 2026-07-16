---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:378-379 - gaslight ingest defines --since default 30d and --limit default 200; positive note, no defect to reproduce"
comment: "Valuable positive: --since 30d and --limit 200 defaults are exactly the bounded-output pattern the unbounded commands lack. Cite it as the in-product precedent from ux-runtime-jobs-ls-help-no-limit-or-since.md, ux-models-dumps-full-catalog.md and ux-runtime-templates-ls-unbounded-noise.md - it proves the convention exists and only needs propagating. Its own 'apply elsewhere' suggestion is the actionable half."
---

# UX: gaslight ingest has --limit and --since (positive)

## Summary

gaslight ingest --help has --since 30d default and --limit 200 — good pagination pattern models/runtime lack.

## Evidence

--since default 30d; --limit default 200

## Why it matters

Positive limit/since pattern to copy to models and runtime jobs ls.

## Suggested direction

Keep; apply elsewhere.

## Severity

Low

## Area

Gaslight / positive pattern
