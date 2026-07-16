---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-usage-list-filter-works.md (same flag, different search term). Consolidate. Its --json aside belongs to ux-usage-list-no-json-flag.md."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/usage.ts:186 declares --filter <model>; src/cli/commands/usage.ts:339-341 case-insensitive bot_name match feeds renderTable; positive note, no defect"
---

# UX: usage list --filter works well (positive)

## Summary

usage list --filter Claude-Haiku returns filtered table with clear costs — good list UX (still no --json).

## Evidence

usage list --filter Claude-Haiku shows filtered cost table.

## Why it matters

Positive filter UX.

## Suggested direction

Keep; add --json.

## Severity

Low

## Area

Usage / positive pattern
