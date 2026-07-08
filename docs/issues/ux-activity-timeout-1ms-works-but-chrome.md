# UX: activity-timeout-ms 1 kills spawn correctly but system chrome

## Summary

Agent spawn timed out after 0.001s of inactivity — correct behavior for extreme timeout; still See logs.

## Evidence

```bash
$ poe-code spawn … --activity-timeout-ms 1
■  Error: Agent spawn timed out after 0.001s of inactivity
```

## Why it matters

Positive timeout enforcement; UserError without logs.

## Suggested direction

Keep timeout; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
