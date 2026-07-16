---
severity: low
impact: none
comment: "Duplicate of ux-usage-list-filter-works-well.md; retire. Filing the same filter twice with different arguments is the audit's most common duplication pattern, visible across models, traces and usage."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: src/cli/commands/usage.ts:186 defines --filter and :338-340 case-insensitively matches bot_name; duplicate of ux-usage-list-filter-works-well.md"
---

# UX: usage list --filter works (positive)

## Summary

usage list --filter Claude-Sonnet shows filtered usage table with Sonnet-4.6 rows — filter works.

## Evidence

20 usage entries; Claude-Sonnet-4.6 rows with costs.

## Why it matters

Positive usage filter.

## Suggested direction

Keep; document on help if needed.

## Severity

Low

## Area

Usage / positive pattern
