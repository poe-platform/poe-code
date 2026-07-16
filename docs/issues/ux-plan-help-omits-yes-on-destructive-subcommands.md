---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan --help lists 'archive [options] [path]' and 'delete [options] [path]' with no --yes, while src/cli/commands/plan.ts:482 throws 'plan <action> requires --yes when running without an interactive TTY.'; duplicate of ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md"
comment: "Fourth filing of the plan destructive help gap; retire into ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md. Its distinct half is the explorer keymap's non-TTY story, which overlaps ux-plan-help-keymap-hint-unframed.md - route it there."
---

# UX: plan --help omits --yes on archive/delete and non-TTY browse policy

## Summary

plan group help lists archive/delete without --yes; explorer keymap e/a/d/n without non-TTY guidance.

## Evidence

plan help Commands include archive/delete; no --yes mentioned.

## Why it matters

Reconfirm destructive plan policy documentation gap.

## Suggested direction

Document --yes; require path non-TTY for archive/delete.

## Severity

**High**

## Area

Plan / help
