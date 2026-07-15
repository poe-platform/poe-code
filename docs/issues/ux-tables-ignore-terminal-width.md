---
severity: medium
impact: polish
comment: "Keep as the umbrella for the table-rendering family and the likely root cause of several filings: ux-provider-list-table-layout-broken.md (cells bleeding across rows), ux-provider-list-agents-column-truncates.md, ux-plan-list-broken-two-line-row-layout.md and ux-wide-tables-truncate-critical-cells.md all describe symptoms of width-unaware layout. Its evidence (wide output at COLUMNS=40) is the concrete repro the others lack. Fix here and the family collapses; needs a design decision on truncate-versus-wrap."
---

# UX: Tables ignore COLUMNS

## Summary

Wide at COLUMNS=40.

## Evidence

provider list.

## Why it matters

Overflow.

## Suggested direction

Width-aware layout.

## Severity

Medium

## Area

Tables
