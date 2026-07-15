---
severity: medium
impact: capability-gap
comment: "Duplicate in substance of ux-harness-list-only-cwd-not-created-dir.md, which demonstrates the consequence rather than merely the missing flag; retire into it. The asymmetry it names is the crisp statement of the bug: harness new accepts --dir and harness list does not, so the tool can create things it cannot find."
---

# UX: harness list has no --dir (cannot list custom scaffold dir)

## Summary

harness new supports --dir; harness list --dir is unknown — cannot list pairs created outside default search paths.

## Evidence

```bash
$ poe-code harness list --dir /tmp/ux-h2
error: unknown option '--dir'
```

## Why it matters

Asymmetric new vs list for custom directories.

## Suggested direction

Add --dir to list/run discovery.

## Severity

Medium

## Area

Harness
