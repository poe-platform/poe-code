---
severity: high
impact: discoverability
comment: "Reconfirm duplicate within the root help footer trio; retire. No new evidence."
---

# UX: root help footer still says Run npm run dev -- <command> --help

## Summary

Root help footer: Run npm run dev -- <command> --help for command options — reconfirm identity leak on footer.

## Evidence

Run npm run dev -- <command> --help for command options.

## Why it matters

Reconfirm displayBinaryName.

## Suggested direction

Run poe-code <command> --help.

## Severity

**High**

## Area

Help / identity
