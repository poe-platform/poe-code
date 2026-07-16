---
severity: high
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/utils/execution-context.ts:200-201 returns 'npm run dev --' for mode=development; program.ts:840 passes it as rootUsageName; probe `npm run dev -- superintendent run --help` printed 'Usage: npm run dev -- superintendent run [OPTIONS] [docs...]'. Global install yields 'poe-code' (utils.test.ts:1045-1058), so the string mirrors actual invocation by design."
comment: "Reconfirm duplicate within the superintendent identity group; retire into the root cause. No new evidence."
---

# UX: superintendent help still npm run dev (reconfirmed)

## Summary

superintendent run/complete help Usage: npm run dev -- superintendent … — reconfirm identity leak on toolcraft-styled commands.

## Evidence

Usage: npm run dev -- superintendent run [OPTIONS]

## Why it matters

Reconfirm displayBinaryName platform fix.

## Suggested direction

Always poe-code in usage.

## Severity

**High**

## Area

Help / identity
