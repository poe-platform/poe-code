---
severity: low
impact: polish
comment: "Contentless twin of ux-plan-path-commands-bare-stdout-reconfirmed.md; retire into it. Its 'humans need context' premise is the weaker reading - a path-printing command exists to be interpolated, so framing would break the primary use."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:1388 process.stdout.write(`${resolvedPath}\n`) and packages/superintendent/src/commands/plan-path.ts:39-45 render.rich print the bare path, so behaviour exists; but it is a deliberate machine-readable convention and this file duplicates ux-plan-path-commands-bare-stdout-reconfirmed.md."
---

# UX: plan-path bare stdout

## Summary

Path only.

## Evidence

pipeline plan-path.

## Why it matters

Humans need context.

## Suggested direction

TTY label.

## Severity

Low

## Area

Plan paths
