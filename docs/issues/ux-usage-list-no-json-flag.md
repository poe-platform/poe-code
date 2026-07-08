# UX: usage list has no --json while other list commands do

## Summary

usage list lacks --json/--output; scripts cannot machine-parse usage history without scraping tables. traces/tasks/plan have --json or --output.

## Evidence

```bash
$ poe-code usage list --json
error: unknown option '--json'
```
usage list only has --filter and --pages.

## Why it matters

CI cost reporting needs machine output.

## Suggested direction

Add --json to usage list and balance.

## Severity

Medium

## Area

Usage
