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
