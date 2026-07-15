---
severity: high
impact: usability
comment: "Duplicate of ux-hooks-strategy-transform-unsupported-opaque.md (same target-side transform refusal); retire into it. The cluster now holds four filings of one capability-matrix gap seen from source and target sides - consolidate to a single issue: filter choices by what is implemented and reject unsupported pairs at parse."
---

# UX: hooks-strategy transform to claude-code not supported yet

## Summary

spawn --hooks-from claude-code --hooks-strategy transform: Transforming hooks to claude-code is not supported yet; only codex-hook targets can be written + See logs.

## Evidence

Transforming hooks to "claude-code" is not supported yet; only codex-hook targets can be written

## Why it matters

Reconfirm hooks capability matrix; late failure after flag accepted.

## Suggested direction

Reject unsupported pairs at parse; list supported source→target matrix.

## Severity

**High**

## Area

Hooks / spawn
