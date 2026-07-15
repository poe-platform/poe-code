---
severity: low
impact: none
comment: "Positive pattern, no code change. Keep this as the canonical of the three duplicate 0/-1 validation filings: it has the fullest repro and is the only one that states the reusable rule (apply this ValidationError style to all numeric/enum flags), which is the actual value here. Retire the other two."
---

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
