---
severity: medium
impact: discoverability
comment: "One of six filings about memory clear; consolidate. Its claim is the accurate half of the cluster - help documents no --yes - while its framing ('fully destructive when initialized' with no guard) is contradicted by ux-memory-clear-requires-yes-non-tty-good.md, which shows the guard fires. So this is a help gap, not a safety gap: keep the help ask, drop the alarm."
---

# UX: memory clear help still has no --yes/--force (reconfirmed)

## Summary

memory clear --help still only shows -h/--help despite being fully destructive when initialized.

## Evidence

```text
Usage: poe-code memory clear [options]
Delete all memory content and re-initialize INDEX.md and LOG.md.
Options: -h, --help
```

## Why it matters

Reconfirmed destructive help gap.

## Suggested direction

Require --yes non-TTY; confirm TTY; document irreversibility.

## Severity

Medium

## Area

Destructive
