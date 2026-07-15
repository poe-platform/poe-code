---
severity: low-medium
impact: correctness
comment: "Duplicate within the models empty-filter trio; retire into ux-models-empty-search-returns-all.md. No distinct content."
---

# UX: models --provider "" returns all 341 models

## Summary

models --provider "" → 341/341 models — empty provider ignored (empty flag class).

## Evidence

--provider "" → 341/341 models listed.

## Why it matters

Explicit empty provider should error.

## Suggested direction

Reject empty --provider when present.

## Severity

Low–Medium

## Area

Models
