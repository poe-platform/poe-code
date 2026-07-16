---
severity: high
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- --help prints 'Usage: npm run dev -- <command> [...args]'; source src/utils/execution-context.ts:197-201 formatCliUsageCommand returns 'npm run dev --' for mode development, consumed at src/cli/program.ts:840 and rendered at src/cli/program.ts:259. Note the doc's named symbol displayBinaryName does not exist in src/ or packages/. Duplicate of the root usage-line trio (ux-root-help-usage-line-is-npm-run-dev.md, ux-root-help-usage-still-npm-run-dev-reconfirmed.md); dev-mode-only string, published binary shows poe-code"
comment: "Reconfirm duplicate within the root usage-line trio; retire. It does usefully separate the two root help problems (identity leak versus hidden commands), which the cluster otherwise keeps conflating - keep them as distinct issues with distinct fixes."
---

# UX: root --help Usage still npm run dev (reconfirmed)

## Summary

root --help: Usage: npm run dev -- <command> [...args] — displayBinaryName leak still open; hides half of commands separately Critical.

## Evidence

Usage: npm run dev -- <command> [...args]

## Why it matters

Reconfirm identity leak on root help.

## Suggested direction

Usage: poe-code <command> [...args]

## Severity

**High**

## Area

Help / identity
