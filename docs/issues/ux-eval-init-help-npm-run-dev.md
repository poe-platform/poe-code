---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- eval init --help line 22 prints 'Usage: npm run dev -- eval init [OPTIONS] <name>'; source is src/utils/execution-context.ts formatCliUsageCommand development case returning 'npm run dev --'; duplicate of ux-development-mode-usage-intentional-but-leaks.md"
comment: "Per-command npm run dev filing with no distinct content; retire into ux-development-mode-usage-intentional-but-leaks.md. The eval group alone contributes four of these (eval, eval run, eval init, eval report) - all one fix."
---

# UX: eval init help Usage npm run dev

## Summary

eval init help Usage: npm run dev -- eval init — identity leak.

## Evidence

Usage: npm run dev -- eval init [OPTIONS] <name>

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

poe-code in Usage.

## Severity

Medium

## Area

Help / identity
