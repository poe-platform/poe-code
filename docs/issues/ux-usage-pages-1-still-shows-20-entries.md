# UX: usage list --pages 1 still shows 20 entries (page size opaque)

## Summary

usage list --pages 1 still fetches/displays 20 usage entries — --pages means number of pages not page size, but help says Number of pages to load automatically without page size documentation.

## Evidence

```bash
$ poe-code usage list --pages 1
◆  20 usage entries fetched
# 20 rows shown
```

## Why it matters

Users think --pages 1 means 1 entry or page size 1.

## Suggested direction

Document page size (20); or add --limit.

## Severity

Medium

## Area

Usage
