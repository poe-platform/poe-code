---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:276-279 uses Commander Option.choices(); `npm run dev -- models --view bogus` prints: error: option '--view <name>' argument 'bogus' is invalid. Allowed choices are capabilities, pricing, parameters, raw."
comment: "Duplicate of ux-models-view-invalid-uses-raw-commander.md; consolidate. Both are instances of ux-raw-commander-invalid-option-choices.md and both note the sharper irony: within the same command, --endpoint produces a design-system error listing valid values while --view falls through to Commander, so models validates two enums two different ways."
---

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
