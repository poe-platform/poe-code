# UX: pipeline validate has no --json flag

## Summary

pipeline validate --json is unknown option — cannot machine-parse validation results.

## Evidence

```bash
$ poe-code pipeline validate … --json
error: unknown option '--json'
```

## Why it matters

CI needs machine-readable validate.

## Suggested direction

Add --json success/error payload.

## Severity

Medium

## Area

Pipeline
