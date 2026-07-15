---
severity: medium
impact: capability-gap
comment: "Member of the --json inconsistency family; retire into ux-json-flag-inconsistent-across-commands.md. Its case is among the better ones and worth carrying: usage is cost data, so CI cost reporting is a real scripting need, and it correctly notes traces/tasks/plan already have machine output - making this the odd one out rather than a new feature."
---

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
