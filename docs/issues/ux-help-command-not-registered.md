---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- help exits 1 with 'Unknown command: help'; no help entry in ROOT_HELP_COMMAND_SPECS or bootstrapProgram registrations (src/cli/program.ts:80-100, 831-900)"
comment: "Small and real: 'poe-code help' is a near-universal habit and returns Unknown command, even though 'help [command]' exists inside the groups (ux-harness-help-command-lowercase-description.md). So the subcommand exists while the root verb does not - an inconsistency rather than a missing feature. Cheap fix with good first-touch payoff. Related to ux-help-subcommand-inconsistency.md."
---

# UX: poe-code help unknown

## Summary

help not registered.

## Evidence

help → unknown.

## Why it matters

Universal habit fails.

## Suggested direction

Register help.

## Severity

Medium

## Area

Help
