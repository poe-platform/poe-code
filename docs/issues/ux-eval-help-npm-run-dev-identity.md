---
severity: medium
impact: discoverability
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
