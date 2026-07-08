# UX: harness run success shows opaque Result: object · kind, version…

## Summary

Successful harness run prints Result: object · kind, version, message, numbers, branches, +1 more — internal shape dump not user-meaningful.

## Evidence

```bash
$ poe-code harness run /tmp/h5/cov1.md --yes
◆  Ran /tmp/h5/cov1.md
◆  Result: object · kind, version, message, numbers, branches, +1 more
●  Usage: 0 spawns
```

## Why it matters

Success should summarize harness outcome in plain language.

## Suggested direction

Show assertion pass/fail counts; --json for raw result.

## Severity

Medium

## Area

Harness
