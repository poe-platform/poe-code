# UX: models has no --limit for large catalog tables

## Summary

models --limit 5 is unknown option — 341-model tables always dump many rows; no pagination flag.

## Evidence

```bash
$ poe-code models --limit 5
error: unknown option '--limit'
```

## Why it matters

Wide catalogs need pagination for usability.

## Suggested direction

Add --limit default 50; --all for full.

## Severity

Medium

## Area

Models
