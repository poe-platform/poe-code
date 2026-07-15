---
severity: medium
impact: discoverability
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
