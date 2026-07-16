---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/pipeline.ts:874-878 registers the pipeline group with no .action(); `npm run dev -- pipeline` prints usage/options/commands list only, no next-step hint."
comment: "Contentless but names a real first-run stall: bare 'pipeline' prints help and nothing else, so users get a wall of options rather than a next step. Overlaps ux-skill-parent-no-next-step-guidance.md and ux-runtime-templates-parent-no-default-subcommand.md - the same shape across group commands. Worth one decision: should a group invoked without a subcommand suggest the likely next command? Fold the three together."
---

# UX: Parent groups only dump help

## Summary

pipeline bare help only.

## Evidence

pipeline.

## Why it matters

First-time stall.

## Suggested direction

Default action/next step.

## Severity

Medium

## Area

First-run
