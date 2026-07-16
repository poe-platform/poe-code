---
severity: low-medium
impact: correctness
comment: "Duplicate within the models empty-filter trio; retire into ux-models-empty-search-returns-all.md. No distinct content."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:372 `if (commandOptions.provider)` - empty string is falsy so the provider filter is skipped and all models are returned; canonical duplicate ux-models-empty-search-returns-all.md already covers --provider \"\"."
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
