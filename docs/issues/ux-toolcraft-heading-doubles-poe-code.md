---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- approvals --help prints 'Poe - poe-code approvals — Inspect and execute queued approvals.'; heading from src/cli/program.ts:352 resolveRootHelpHeading returning 'Poe - poe-code' joined with breadcrumb at packages/toolcraft/src/cli.ts:1457,2604"
comment: "Duplicate of the title observation already carried by ux-eval-help-npm-run-dev-and-inline-flags.md and ux-superintendent-help-format-inconsistencies.md; consolidate. Small and real: 'Poe - poe-code eval' repeats the product name because the toolcraft heading prepends 'Poe -' to a command string that already includes the binary. One fix across every toolcraft-hosted group."
---

# UX: Toolcraft title Poe - poe-code cmd

## Summary

Double name heading.

## Evidence

approvals --help screenshot.

## Why it matters

Unfinished look.

## Suggested direction

Poe - <cmd> only.

## Severity

Medium

## Area

Help / visual
