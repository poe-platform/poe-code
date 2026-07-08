# UX: utils symlink agents already linked is calm (positive)

## Summary

utils symlink agents --dry-run prints already linked without error — good idempotent message.

## Evidence

```bash
$ poe-code utils symlink agents --dry-run
●  already linked
```

## Why it matters

Positive idempotent UX.

## Suggested direction

Keep.

## Severity

Low

## Area

Utils / positive pattern
