# UX: runtime jobs ls --help has no --limit or --since

## Summary

runtime jobs ls help only -h — no --limit/--since despite unbounded May-era job list (reconfirm platform fix gap).

## Evidence

runtime jobs ls Options: -h only.

## Why it matters

Jobs ls floods with stale rows; filters missing on help and CLI.

## Suggested direction

Add --limit and --since; default recent window.

## Severity

**High**

## Area

Runtime jobs
