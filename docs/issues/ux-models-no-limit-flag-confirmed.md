---
severity: high
impact: capability-gap
comment: "Keep as canonical of this pair. Its comparison is the useful part and makes the fix cheap: traces already has --limit while models does not, so the convention exists in-product and only needs propagating (ux-gaslight-ingest-has-limit-since-good.md shows the same for --since/--limit defaults). Consolidate with ux-models-dumps-full-catalog.md, the same problem stated from the output side."
---

# UX: models has no --limit flag (confirmed live)

## Summary

models --limit 5 unknown option; traces has --limit but models does not. 341-row default flood.

## Evidence

error: unknown option '--limit'
models --help has no --limit; traces --help has --limit <n>.

## Why it matters

Inconsistent pagination; models unusable in narrow TTY/CI.

## Suggested direction

Add models --limit; default soft cap.

## Severity

**High**

## Area

Models
