---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/ralph.ts:687,768 register only init/run; `npm run dev -- ralph --help` lists only init and run, while validate exists at src/cli/commands/experiment.ts:1027, src/cli/commands/pipeline.ts:1267 and packages/superintendent/src/commands/superintendent-group.ts:48"
comment: "Real parity gap, well evidenced: pipeline, experiment and superintendent all have validate and ralph does not. Same command-surface divergence as the installer flags and permission modes - the harnesses were built separately with no shared contract. Its 'or document absence' alternative is fair, but validate is the cheapest way to surface the frontmatter requirement that makes ralph init and ralph run confusing, so it carries more value here than parity alone suggests."
---

# UX: ralph has no validate command

## Summary

ralph validate unknown command while experiment/superintendent/pipeline have validate.

## Evidence

error: unknown command 'validate' under ralph

## Why it matters

Inconsistent harness validation surface.

## Suggested direction

Add ralph validate or document absence.

## Severity

Medium

## Area

Ralph
