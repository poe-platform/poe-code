---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- eval run prints '2 parameter errors' then 'Run npm run dev -- eval run --help for usage.'; mechanism is src/utils/execution-context.ts:197-206 formatCliUsageCommand returning 'npm run dev --' for mode development"
comment: "Per-command npm run dev filing with no distinct content; retire into ux-development-mode-usage-intentional-but-leaks.md."
---

# UX: eval run missing params uses npm run dev in recovery

## Summary

eval run without agent/model: 2 parameter errors … Run npm run dev -- eval run --help — toolcraft-style help identity.

## Evidence

eval run → parameter errors + npm run dev -- eval run --help

## Why it matters

Reconfirm displayBinaryName on eval.

## Suggested direction

displayBinaryName=poe-code.

## Severity

Medium

## Area

Eval / identity
