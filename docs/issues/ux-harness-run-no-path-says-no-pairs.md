# UX: harness run without path says No harness pairs found

## Summary

harness run --yes without md-path: No harness pairs found — OK if empty, but does not prompt to pick or suggest harness new.

## Evidence

```bash
$ poe-code harness run --yes
■  No harness pairs found.
```

## Why it matters

Missing next-step to create harness.

## Suggested direction

Suggest harness new <kind> <name>; list search paths.

## Severity

Low–Medium

## Area

Harness
