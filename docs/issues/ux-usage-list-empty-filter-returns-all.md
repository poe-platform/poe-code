---
severity: low-medium
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "usage.ts:220 filterTerm = options.filter?.trim() yields \"\"; usage.ts:338 `filterTerm ? ...` is falsy so no filter applied and all entries print; no validation rejects empty --filter"
comment: "Instance of the empty-flag family; retire into ux-empty-model-flag-behavior-inconsistent.md, whose single rule covers it. Worth noting the irony it exposes: usage list has the best no-match message in the product (ux-usage-list-no-match-message-good.md) and still cannot tell an empty filter from no filter."
---

# UX: usage list --filter "" returns all entries

## Summary

usage list --filter "" still shows 20 entries — empty filter ignored (empty flag class).

## Evidence

usage list --filter "" → full list of 20 entries.

## Why it matters

Explicit empty filter should error or match nothing.

## Suggested direction

Reject empty --filter when present.

## Severity

Low–Medium

## Area

Usage
