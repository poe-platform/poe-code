---
severity: medium
impact: usability
comment: "Legitimate and distinct from the harness positives that cite this same line as proof of success: 'Result: object - kind, version, message, numbers, branches, +1 more' is a shape dump, not an outcome, so users cannot tell whether the harness passed. Its suggestion is right: report assertion pass/fail counts and put the raw object behind --json. Note this undercuts the positive filings (ux-harness-run-coverage-demo-works.md) that treat the object dump as evidence the run worked."
---

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
