---
severity: low
impact: none
comment: "Positive pattern, no code change. One of three near-identical filings of the same --activity-timeout-ms 0 validation observation (with ux-activity-timeout-zero-good-validation.md and ux-activity-timeout-zero-validation-good.md). Consolidate the three; ux-activity-timeout-zero-good-validation.md has the strongest evidence and should survive."
---

# UX: --activity-timeout-ms 0 validation is good (positive)

## Summary

spawn --activity-timeout-ms 0: Invalid --activity-timeout-ms "0". Expected a positive integer — clear ValidationError without stack.

## Evidence

Invalid --activity-timeout-ms "0". Expected a positive integer.

## Why it matters

Positive integer validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern
