---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- doctor prints 'Unknown command: doctor'; no doctor command registered in src/cli/commands (rg found zero matches). Duplicate of ux-no-doctor-or-health-overview-command.md and ux-doctor-still-missing-reconfirmed-2026-07-08.md."
comment: "Reconfirm duplicate with no argument beyond 'still missing'; retire into ux-doctor-still-missing-reconfirmed-2026-07-08.md. Recording the absence of one command four times at two different severities adds nothing."
---

# UX: doctor still missing (reconfirmed)

## Summary

doctor remains Unknown command with npm run dev help.

## Evidence

Unknown command: doctor

## Why it matters

Reconfirm doctor overview gap.

## Suggested direction

Add doctor; displayBinaryName.

## Severity

Medium

## Area

Help
