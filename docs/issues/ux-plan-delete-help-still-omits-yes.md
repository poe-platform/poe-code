---
severity: high
impact: usability
comment: "Reconfirm duplicate within the plan archive/delete help cluster; retire into ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md, which covers both commands. No new evidence."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan delete --help lists only --kind, --output, -h; src/cli/commands/plan.ts:736-749 registers no --yes while plan.ts:485 calls requireInteractiveStdin; -y is root-only at src/cli/program.ts:852"
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
