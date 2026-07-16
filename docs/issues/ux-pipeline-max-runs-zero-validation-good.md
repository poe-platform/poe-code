---
severity: low
impact: none
comment: "Duplicate of ux-pipeline-max-runs-zero-good-validation.md (same observation, transposed filename); retire. The numeric-validation positive family now spans activity-timeout, gaslight ingest limit, markdown-read depth and this - one note covers them all."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:222 resolveMaxRuns throws ValidationError 'Invalid max-runs \"0\". Expected a positive integer.' for values < 1; positive note, no defect. Duplicate file docs/issues/ux-pipeline-max-runs-zero-good-validation.md exists."
---

# UX: pipeline --max-runs 0 validation is good (positive)

## Summary

pipeline run --max-runs 0: Invalid max-runs "0". Expected a positive integer — clear ValidationError.

## Evidence

Invalid max-runs "0". Expected a positive integer.

## Why it matters

Positive integer validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Pipeline / positive pattern
