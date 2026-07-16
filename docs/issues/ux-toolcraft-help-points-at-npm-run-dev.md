---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:197-210 formatCliUsageCommand returns 'npm run dev --' only for detected development mode and 'poe-code' for global; src/cli/program.ts:840,907-956 passes that dynamic usageCommand as rootUsageName to every toolcraft group, so nothing is baked"
comment: "The best-scoped statement of the identity cluster after the root-cause file: it identifies that toolcraft groups as a class bake the monorepo invocation, which is why eval, superintendent, code-review, gh and approvals all leak it. Retire into ux-development-mode-usage-intentional-but-leaks.md, keeping this as the scope note - roughly fifteen filings across those groups collapse into one change."
---

# UX: Toolcraft help/errors say npm run dev

## Summary

Toolcraft groups bake monorepo invocation.

## Evidence

eval/superintendent help Usage npm run dev.

## Why it matters

Copy-paste fails outside repo.

## Suggested direction

display binary poe-code.

## Severity

**High**

## Area

Help / identity
