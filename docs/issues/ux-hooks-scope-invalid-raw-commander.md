---
severity: low-medium
impact: usability
comment: "Duplicate in substance of ux-hooks-strategy-invalid-raw-commander.md (same raw-Commander enum error, different flag); consolidate, and note both are instances of ux-raw-commander-invalid-option-choices.md. Commander's message content is actually good - it lists the allowed choices - so the only defect is the skin, making this a cheap win once Commander errors are mapped into the design system."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:120 Option('--hooks-scope <scope>').choices(['project','user','merged']) with no design-system mapping (src/cli/bootstrap.ts:47 exitOverride:false, src/cli/program.ts:856 showHelpAfterError(false)); `npm run dev -- spawn claude hi --hooks-scope bogus` prints unstyled: error: option '--hooks-scope <scope>' argument 'bogus' is invalid. Allowed choices are project, user, merged."
---

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
