# UX: activity-timeout-ms 0 validates well (positive pattern)

## Summary

Invalid --activity-timeout-ms "0" returns a clear ValidationError-style message without raw Commander text — positive pattern to copy elsewhere; tracked for consistency reference not as a bug.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --activity-timeout-ms 0
■  Invalid --activity-timeout-ms "0". Expected a positive integer.
```
(No errors.log footer in this capture — good.)

## Why it matters

Contrast with raw Commander invalid choices and system chrome path errors.

## Suggested direction

Use this validation style for all numeric/enum flags.

## Severity

Low

## Area

Errors / positive pattern
