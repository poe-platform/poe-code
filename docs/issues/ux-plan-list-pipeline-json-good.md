---
severity: low
impact: none
comment: "Positive pattern; consolidate with the md-export positive. Its incidental detail is the interesting one: the JSON includes a detail field with '21/21 done', so the machine contract carries progress - useful for CI and worth documenting rather than merely praising."
---

# UX: plan list --kind pipeline --output json is clean (positive)

## Summary

JSON array with kind, path, detail 21/21 done — good machine-readable pipeline list.

## Evidence

plan list --kind pipeline --output json → single pipeline object with detail.

## Why it matters

Positive JSON list for scripts.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan list / positive pattern
