---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:618 .requiredOption('--task <qualifiedId>') on maestro tick emits raw Commander error, not design-system ValidationError"
comment: "Duplicate in substance of ux-maestro-tick-missing-transition-raw-commander.md; consolidate - both are instances of the raw-Commander required-option gap (ux-raw-commander-missing-args.md). Its distinct observation is worth keeping: --yes does not suppress a required-option error, which is correct but surprising enough that the two files together argue tick should list all its requirements at once."
---

# UX: maestro tick missing --task is raw commander error

## Summary

maestro tick --yes: error: required option --task not specified — raw commander; --yes ignored for required option.

## Evidence

error: required option '--task <qualifiedId>' not specified

## Why it matters

Design-system ValidationError.

## Suggested direction

ValidationError: --task is required for tick.

## Severity

Medium

## Area

Maestro
