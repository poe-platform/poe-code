---
severity: low
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:495-556 gives `maestro [path]` its own action while :563-612 registers `maestro run` with the identical description 'Run the Maestro task-driven agent daemon.'; the same hybrid parent+subcommand shape appears in src/cli/commands/gaslight.ts:310-324 and src/cli/commands/plan.ts:522-533, so it is an established CLI convention already tracked in ux-gaslight-hybrid-command-confusing-structure.md"
comment: "Contentless, but it names the same hybrid-command shape as ux-gaslight-hybrid-command-confusing-structure.md - a parent that both acts and hosts subcommands. Fold both into one command-shape decision rather than tracking per command; the gaslight file has the actual analysis."
---

# UX: Maestro dual invocation

## Summary

Parent + run unclear.

## Evidence

maestro --help.

## Why it matters

Scripts fork.

## Suggested direction

One default.

## Severity

Low

## Area

Maestro
