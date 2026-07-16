---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:78 declares '--reasoning-effort <level>' with no argParser/choices; src/cli/prompts.ts:95-101 prompts free text; 'npm run dev -- configure --help' prints '--reasoning-effort <level>  Reasoning effort level' with no enum or examples. Duplicate of ux-reasoning-effort-bogus-silently-ignored.md."
comment: "Contentless duplicate of the effort validation ask; retire into ux-reasoning-effort-bogus-silently-ignored.md. Its 'cost control' framing is the useful half and is the strongest user-facing argument in the whole effort cluster: effort maps directly to spend, so a silently ignored flag has a financial consequence rather than merely a behavioral one."
---

# UX: reasoning-effort no enum

## Summary

No validation/examples.

## Evidence

configure --reasoning-effort weird.

## Why it matters

Cost control.

## Suggested direction

Document validate.

## Severity

Medium

## Area

Configure
