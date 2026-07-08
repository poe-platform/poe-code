# UX: plan list --kind invalid validation is good (positive)

## Summary

Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base.

## Evidence

```bash
$ poe-code plan list --kind bogus
■  Invalid --kind value "bogus". Expected plan, pipeline, …
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
