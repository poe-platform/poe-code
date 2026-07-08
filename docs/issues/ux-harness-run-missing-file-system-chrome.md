# UX: harness run missing md uses system chrome

## Summary

Missing harness md file: path + See logs — good message, unnecessary logs.

## Evidence

```bash
$ poe-code harness run /tmp/no.md
■  Error: Missing harness md file: /tmp/no.md
●  See logs …
```

## Why it matters

ValidationError without logs.

## Suggested direction

UserError; suggest harness new / harness list.

## Severity

Medium

## Area

Harness
