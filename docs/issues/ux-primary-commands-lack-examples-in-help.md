---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:299 has 'Examples:' via addHelpText; rg addHelpText finds only models.ts and plan.ts, so configure.ts/spawn.ts have none. 'npm run dev -- configure --help' and 'spawn --help' both end at Options with no Examples section."
comment: "Contentless twin of ux-primary-commands-still-lack-examples.md; retire into it. The ask is legitimate and the answer already exists in-product - ux-models-help-examples-are-excellent.md is the template - so this is propagation rather than design."
---

# UX: Primary commands lack Examples

## Summary

models has Examples; configure/spawn do not.

## Evidence

help pages.

## Why it matters

Copy-paste learning.

## Suggested direction

Add Examples.

## Severity

Medium

## Area

Help
