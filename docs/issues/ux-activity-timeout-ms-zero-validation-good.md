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
