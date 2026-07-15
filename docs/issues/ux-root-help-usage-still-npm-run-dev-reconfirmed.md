---
severity: high
impact: discoverability
comment: "Third duplicate within the root usage-line trio; retire. Like its sibling it qualifies the finding with 'when run via tsx', the caveat the whole identity cluster needs: verify against an installed binary before treating six or seven High filings as real user-facing defects."
---

# UX: root help Usage still npm run dev (reconfirmed)

## Summary

Root help Usage: npm run dev -- <command> [...args] — reconfirm development-mode identity when run via tsx.

## Evidence

```text
Usage: npm run dev -- <command> [...args]
```

## Why it matters

Reconfirm displayBinaryName critical for help.

## Suggested direction

Always show poe-code in usage.

## Severity

**High**

## Area

Help / identity
