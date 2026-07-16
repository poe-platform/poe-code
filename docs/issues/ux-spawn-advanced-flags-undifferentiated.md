---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "`npm run dev -- spawn --help` lists 22 flat options with no groups/examples; src/cli/commands/spawn.ts:95-138 plus addRuntimeOptions (src/cli/commands/runtime-options.ts:11-24) register them with no addHelpText sections"
comment: "Contentless but real: spawn has roughly twenty ungrouped flags spanning prompt, runtime, hooks, logging and telemetry, so the help is a wall. Pairs naturally with the missing-examples ask (ux-primary-commands-still-lack-examples.md) - grouping plus examples is one piece of work on the same panel, and ux-models-help-examples-are-excellent.md shows the target shape."
---

# UX: spawn help flat advanced wall

## Summary

~20 options ungrouped.

## Evidence

spawn --help.

## Why it matters

Learnability.

## Suggested direction

Group + examples.

## Severity

Medium

## Area

Spawn help
