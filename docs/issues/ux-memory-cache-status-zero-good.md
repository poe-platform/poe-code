---
severity: low
impact: none
comment: "Positive pattern, no action: '0 cache entries (0 bytes)' states the empty case with a unit, better than most empty states in the audit (compare the plan list empty-table filings). Cite as a small precedent for the empty-state convention work."
reproduced: n
recommendation: no-fix
evidence: "packages/memory/src/cache.cli.ts:13 and src/cli/commands/memory.ts:514 emit `${status.entries} cache entries (${status.bytes} bytes)` with singular/plural handling, so zero renders '0 cache entries (0 bytes)' as described; positive note, no defect to reproduce."
---

# UX: memory cache status empty is clear (positive)

## Summary

memory cache status: 0 cache entries (0 bytes) — clear empty state.

## Evidence

●  0 cache entries (0 bytes)

## Why it matters

Positive status empty.

## Suggested direction

Keep.

## Severity

Low

## Area

Memory / positive pattern
