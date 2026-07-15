---
severity: medium
impact: correctness
comment: "Keep as canonical of the silent-filter-validation pair (with ux-models-input-bogus-silent-empty.md, the same defect for --input): an invalid feature name returns 0 models rather than an error, so a typo is indistinguishable from an empty catalog - the same false-empty class as ux-approvals-invalid-state-silent-empty-reconfirmed.md. Its strongest point: help already documents the valid set (tools, web_search, reasoning), so the allow-list exists and simply is not enforced."
---

# UX: models --feature bogus silently returns empty (reconfirmed filter semantics)

## Summary

Invalid feature name returns 0 models / No models match rather than invalid feature error — reconfirm of silent filter issues.

## Evidence

```bash
$ poe-code models --feature bogus
●  0/341 models
●  No models match the given filters.
```
Help says feature is tools, web_search, or reasoning.

## Why it matters

Typos look like empty catalog.

## Suggested direction

Validate --feature against allow-list; suggest valid names.

## Severity

Medium

## Area

Models
