---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan archive --help lists only --kind, --output, -h; src/cli/commands/plan.ts:717-731 registers no --yes while plan.ts:479 errors 'plan archive requires --yes when running without an interactive TTY'"
comment: "Reconfirm duplicate within the plan archive help trio; retire. No new evidence."
---

# UX: plan archive --help still omits --yes (reconfirmed)

## Summary

plan archive help only lists path, --kind, --output, -h — no --yes despite non-TTY requiring it and destructive archive behavior.

## Evidence

plan archive Options: --kind, --output, -h only.

## Why it matters

Reconfirm destructive help gap (with plan delete omit --yes).

## Suggested direction

Document --yes; require path non-TTY; blast-radius note.

## Severity

**High**

## Area

Plan / destructive
