---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- superintendent --help prints 'Usage: npm run dev -- superintendent [command] [OPTIONS]' and code-review --help prints 'Usage: npm run dev -- code-review [command] [OPTIONS]'; both toolcraft groups receive rootUsageName from src/cli/program.ts:840 (formatCliUsageCommand) registered at src/cli/program.ts:842-847 and 726, with the development case returning 'npm run dev --' at src/utils/execution-context.ts:197-201 — same root cause as ux-development-mode-usage-intentional-but-leaks.md; displayBinaryName does not exist in src/ or packages/"
comment: "Duplicate within the identity cluster; retire into ux-development-mode-usage-intentional-but-leaks.md. Its one useful contribution is scoping: superintendent and code-review share the behavior, supporting the theory that all toolcraft-hosted groups inherit it from one place."
---

# UX: superintendent and code-review help still npm run dev

## Summary

superintendent and code-review Usage: npm run dev -- … — identity leak class.

## Evidence

Usage: npm run dev -- superintendent [command]
Usage: npm run dev -- code-review [command]

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

poe-code in Usage.

## Severity

Medium

## Area

Help / identity
