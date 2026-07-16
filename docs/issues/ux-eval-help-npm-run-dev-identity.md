---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- eval --help prints heading 'Poe - poe-code eval' and 'Usage: npm run dev -- eval [command] [OPTIONS]' plus footer 'Run npm run dev -- <command> --help'; source src/utils/execution-context.ts:197-201 (formatCliUsageCommand development case) via src/cli/program.ts:840-841 — same root cause as ux-development-mode-usage-intentional-but-leaks.md"
comment: "One of many per-command npm run dev filings with no distinct content; retire into the root cause ux-development-mode-usage-intentional-but-leaks.md."
---

# UX: eval help Usage still npm run dev

## Summary

eval and eval run help Usage: npm run dev -- eval … — identity leak; also toolcraft-style heading poe-code eval.

## Evidence

Usage: npm run dev -- eval [command] [OPTIONS]

## Why it matters

Reconfirm displayBinaryName across eval.

## Suggested direction

poe-code in Usage.

## Severity

Medium

## Area

Help / identity
