---
severity: low-medium
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:378 'if (commandOptions.model)' skips filter on empty string; hasActiveFilters uses '!== undefined' so the count line still prints all models. Duplicate of canonical ux-empty-model-flag-behavior-inconsistent.md (reproduced=y, recommendation=fix)."
comment: "One of three filings of the empty-filter behavior on models; consolidate into ux-models-empty-search-returns-all.md, which covers two flags at once. All belong to the empty-flag family whose canonical is ux-empty-model-flag-behavior-inconsistent.md - the shared rule (an explicit empty flag is a ValidationError, never a no-op) closes them."
---

# UX: models --model "" returns all 341 models

## Summary

models --view pricing --model "" → 341/341 models — empty --model ignored (empty flag class).

## Evidence

--model "" → 341/341 pricing table

## Why it matters

Explicit empty filter should error.

## Suggested direction

Reject empty --model when present.

## Severity

Low–Medium

## Area

Models
