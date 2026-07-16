---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/utils/execution-context.ts:203 returns 'npm run dev --' only for mode=development; detectExecutionContext (line 51-58) returns command 'poe-code'/'poe' for global installs, so installed `poe-code --help` never prints npm run dev. Probe `npm run dev -- --help` prints 'Usage: npm run dev -- <command> [...args]', which is the intended dev-mode rendering."
comment: "One of three filings of the root usage-line leak; consolidate and retire into ux-development-mode-usage-intentional-but-leaks.md. Its 'highest-traffic copy-paste wrong' framing is the best one-line argument in the identity cluster and should survive - if the usage line is wrong, the first thing every user copies is wrong."
---

# UX: Root --help Usage is npm run dev

## Summary

Root help Usage: npm run dev -- <command>.

## Evidence

poe-code --help.

## Why it matters

Highest-traffic copy-paste wrong.

## Suggested direction

Always poe-code.

## Severity

**High**

## Area

Help / identity
