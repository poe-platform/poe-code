---
severity: low-medium
impact: correctness
comment: "Duplicate of ux-models-empty-search-returns-all.md, which covers --search and --provider together; retire into it. Part of the empty-flag family (ux-empty-model-flag-behavior-inconsistent.md)."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:384 'if (commandOptions.search)' is a truthiness check, so --search \"\" skips the filter while hasActiveFilters at :170 tests '!== undefined' and still prints the N/N count; behaviour is real but tracked canonically in ux-models-empty-search-returns-all.md (reproduced: y, recommendation: fix)."
---

# UX: models --search "" returns all 341 models

## Summary

models --search "" → 341/341 models — empty search ignored (empty flag class).

## Evidence

--search "" → 341/341 models listed.

## Why it matters

Explicit empty search should error or match nothing.

## Suggested direction

Reject empty --search when present.

## Severity

Low–Medium

## Area

Models
