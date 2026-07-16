---
severity: medium
impact: usability
comment: "Instance of the raw-Commander required-option gap; retire into ux-raw-commander-missing-args.md. Its distinct ask is worth keeping: list the valid agents in the error, which the capability-matrix work would supply for free. Note --yes does not help here either, the same observation as ux-maestro-tick-missing-task-raw-commander.md."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:447 uses .requiredOption('--agent <agent>') with no choices; `npm run dev -- memory install --yes` prints: error: required option '--agent <agent>' not specified"
---

# UX: memory install requires --agent via raw commander error

## Summary

memory install without --agent: error: required option '--agent <agent>' not specified — raw commander, not design-system; no agent choices listed.

## Evidence

```bash
$ poe-code memory install --yes
error: required option '--agent <agent>' not specified
```

## Why it matters

Missing required flag should list agents and use design-system.

## Suggested direction

ValidationError with agent choices; or prompt with --yes default.

## Severity

Medium

## Area

Memory
