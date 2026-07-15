---
severity: medium
impact: discoverability
comment: "One of three filings about memory cache clear; consolidate. The shared point is narrow but true: the --yes guard exists and works (ux-memory-cache-clear-requires-yes-good.md) while help documents only --older-than and -h, so the guard is invisible until it fires. Same undocumented-global-flag family as ux-global-flags-hidden-on-subcommand-help.md."
---

# UX: memory cache clear --help still omits --yes (reconfirmed)

## Summary

memory cache clear help has --older-than and -h only; prior probe required --yes for clear. Help gap remains.

## Evidence

memory cache clear Options: --older-than, -h only

## Why it matters

Reconfirm destructive help gap for cache clear.

## Suggested direction

Document --yes; refuse without --yes non-TTY.

## Severity

Medium

## Area

Memory
