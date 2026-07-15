---
severity: low
impact: none
comment: "One of two identical --max-runs 0 positives; consolidate with ux-pipeline-max-runs-zero-validation-good.md - the filenames are near-transpositions of each other, itself a sign of duplicate filing. Part of the numeric-validation positive family that should collapse to one reference note."
---

# UX: pipeline --max-runs 0 validates cleanly (positive)

## Summary

Invalid max-runs "0" returns clear positive-integer validation without raw Commander text — positive pattern (still has Problems-before-error lifecycle).

## Evidence

```bash
$ poe-code pipeline run --max-runs 0 --yes …
■  Invalid max-runs "0". Expected a positive integer.
```

## Why it matters

Documents good validation to copy; lifecycle still an issue.

## Suggested direction

Keep validation; fix panel lifecycle separately.

## Severity

Low

## Area

Pipeline / positive pattern
