---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/components/table.ts:223-238 getColumnWidth/computeColumns size table columns only from column.maxLen and the non-detail path at table.ts:317-375 never reads options.maxWidth or terminal columns (only variant 'detail' uses maxWidth at table.ts:329); src/cli/commands/provider.ts:100-107 passes fixed maxLen 20/14/34/52/60 with no maxWidth, and probe 'COLUMNS=40 npm run dev -- provider list' emitted 213-char-wide rows/593-char borders"
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
