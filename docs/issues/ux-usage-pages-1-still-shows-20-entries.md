---
severity: medium
impact: discoverability
comment: "Keep as canonical of the --pages pair: it supplies the concrete number the other lacks (a page is 20 entries) and states the misreading precisely - users expect --pages 1 to bound the output and it does not. Consolidate ux-usage-list-pages-exposes-pagination-internals.md into it. The best fix is its alternative: add --limit and let --pages remain an implementation detail, matching traces."
---

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
