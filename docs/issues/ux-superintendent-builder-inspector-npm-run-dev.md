---
severity: medium
impact: none
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- superintendent builder --help prints 'Usage: npm run dev -- superintendent builder [command] [OPTIONS]'; prefix comes from intentional development-mode branch in src/utils/execution-context.ts:196 (formatCliUsageCommand returns 'npm run dev --'), installed binaries print poe-code"
comment: "One of roughly six superintendent npm run dev filings; retire into ux-development-mode-usage-intentional-but-leaks.md. The superintendent group alone contributes six files to the identity cluster for one mechanism - consolidate them all."
---

# UX: superintendent builder/inspector help still npm run dev

## Summary

superintendent builder/inspector help Usage: npm run dev -- superintendent builder … — reconfirm identity.

## Evidence

Usage: npm run dev -- superintendent builder [command]

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

poe-code in usage.

## Severity

Medium

## Area

Help / identity
