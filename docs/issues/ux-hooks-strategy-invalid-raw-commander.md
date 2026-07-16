---
severity: low-medium
impact: usability
comment: "Keep of this pair with ux-hooks-scope-invalid-raw-commander.md; both are instances of ux-raw-commander-invalid-option-choices.md. Its contrast is the useful part: plan list produces a design-system validation error for the same class of mistake, so the inconsistency is internal and the good pattern already exists in-product."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:113 uses Commander Option.choices(); probe 'npm run dev -- spawn --hooks-from claude-code --hooks-strategy bogus' printed raw: error: option '--hooks-strategy <strategy>' argument 'bogus' is invalid. Allowed choices are auto, symlink, transform. No design-system mapping (src/cli/program.ts:856 showHelpAfterError(false), no CommanderError handler)."
---

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
