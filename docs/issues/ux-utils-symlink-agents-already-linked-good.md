---
severity: low
impact: none
comment: "Positive pattern; consolidate with ux-utils-config-init-already-exists-is-info.md into the single already-exists reference. Two commands in the utils group get idempotency right, which strengthens the case that the installers' hard errors are the outliers."
---

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
