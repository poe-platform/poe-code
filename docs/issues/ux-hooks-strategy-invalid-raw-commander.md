# UX: invalid --hooks-strategy is raw commander error

## Summary

spawn --hooks-strategy bogus: error: option argument bogus is invalid. Allowed choices are auto, symlink, transform — raw commander (contrast plan list design-system validation).

## Evidence

error: option '--hooks-strategy <strategy>' argument 'bogus' is invalid. Allowed choices are auto, symlink, transform.

## Why it matters

Inconsistent invalid-enum UX.

## Suggested direction

Design-system ValidationError like plan list.

## Severity

Low–Medium

## Area

Spawn / hooks
