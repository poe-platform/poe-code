---
severity: low
impact: none
comment: "Positive pattern, thin: redundant equivalent flags composing without error is unremarkable. Consolidate into the models filter-composition note. Its 'warn on redundancy' suggestion is not worth doing - warning about a harmless no-op adds noise."
---

# UX: --tools and --feature tools together work (positive)

## Summary

models --tools --feature tools --provider anthropic returns same tool-capable set — redundant flags compose without error.

## Evidence

--tools --feature tools both accepted.

## Why it matters

Positive redundant flag tolerance.

## Suggested direction

Keep; optional warn on redundancy.

## Severity

Low

## Area

Models / positive pattern
