---
severity: high
impact: discoverability
comment: "Reconfirm duplicate within the plan archive/delete help cluster; retire into ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md, which covers both commands. No new evidence."
---

# UX: plan delete --help still omits --yes (reconfirmed)

## Summary

plan delete help only path, --kind, --output, -h — no --yes despite non-TTY requiring it.

## Evidence

plan delete Options: --kind, --output, -h only.

## Why it matters

Reconfirm destructive help gap.

## Suggested direction

Document --yes; require path non-TTY.

## Severity

**High**

## Area

Plan / destructive
