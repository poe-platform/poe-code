# UX: invalid --hooks-scope is raw commander error

## Summary

spawn --hooks-scope bogus: raw commander Allowed choices are project, user, merged — same class as hooks-strategy.

## Evidence

error: option '--hooks-scope <scope>' argument 'bogus' is invalid. Allowed choices are project, user, merged.

## Why it matters

Inconsistent enum validation UX.

## Suggested direction

Design-system ValidationError.

## Severity

Low–Medium

## Area

Spawn / hooks
