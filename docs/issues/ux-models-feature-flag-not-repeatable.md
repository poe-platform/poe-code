---
severity: medium
impact: usability
comment: "Contradicts ux-models-double-feature-flag-uses-last-or-and.md: this claims last-wins from Commander's option shape, that one measures 44/341 and infers AND. The measured number is the stronger evidence, so this file's premise is probably wrong - verify before acting. Its ask survives either way: make --feature collectable or reject duplicates rather than silently resolving them."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:268 declares --feature <name> with no collector fn and src/cli/commands/models.ts:62 types feature?: string, so Commander overwrites; single filter applied at models.ts:391-392, no duplicate rejection"
---

# UX: --feature is not repeatable; second --feature replaces the first

## Summary

models --feature tools --feature reasoning does not AND features; Commander keeps a single string so the last value wins. Help does not say multi-feature requires other syntax.

## Evidence

--feature <name> once; combining with --tools is AND for tools+other only via separate --tools shorthand.
Passing --feature twice is last-wins, not multi-select.

## Why it matters

Users expecting multi-feature filters get silent wrong results.

## Suggested direction

Allow collectable --feature; document AND semantics; or error on duplicate.

## Severity

Medium

## Area

Models
