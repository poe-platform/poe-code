---
severity: high
impact: capability-gap
comment: "Keep as canonical of this pair. Real gap, and the fix already exists in-product: gaslight ingest ships --since 30d --limit 200 defaults (ux-gaslight-ingest-has-limit-since-good.md) and traces has --limit, so this is propagation. It is also the precondition for the not-found trio's recovery advice - 'suggest runtime jobs ls' only helps once ls is usable."
---

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
