---
severity: low
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/pipeline.ts:877 calls .addHelpCommand(false) (same in ralph.ts:684, experiment.ts:732, launch.ts:44, utils.ts:10, utils-symlink.ts:15) while src/cli/commands/harness.ts:74 never does; `npm run dev -- harness --help` lists 'help [command]  display help for command' and `npm run dev -- pipeline --help` omits it entirely"
comment: "Contentless, but points at the same structural issue as ux-dual-help-systems.md and ux-help-command-not-registered.md: several ways to reach help and no stated policy about which applies where. Fold into the help unification umbrella; it contributes no evidence of its own."
---

# UX: Nested help inconsistent

## Summary

Some groups help [command].

## Evidence

harness vs pipeline.

## Why it matters

Three help ways.

## Suggested direction

One policy.

## Severity

Low

## Area

Polish
