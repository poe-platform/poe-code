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
