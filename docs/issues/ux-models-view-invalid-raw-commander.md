# UX: invalid --view is raw commander error

## Summary

models --view bogus: raw commander Allowed choices are capabilities, pricing, parameters, raw — contrast plan list design-system validation.

## Evidence

error: option '--view <name>' argument 'bogus' is invalid. Allowed choices are capabilities, pricing, parameters, raw.

## Why it matters

Inconsistent enum validation UX.

## Suggested direction

Design-system ValidationError.

## Severity

Low–Medium

## Area

Models
