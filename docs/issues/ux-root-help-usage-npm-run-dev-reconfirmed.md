---
severity: high
impact: discoverability
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
