---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- plan install --help` Options lists only --agent/--local/--global/-h, while `npm run dev -- plan install --yes --local --dry-run` runs and reports 'Would install plan skill for claude-code (local).'; --yes is a root flag (src/cli/program.ts:852) consumed via resolveCommandFlags in src/cli/commands/plan.ts:760,791 and subcommand help omits globals (src/cli/program.ts:320 showGlobalOptions never enabled)"
comment: "Instance of the global-flags-not-listed family; retire into ux-global-flags-hidden-on-subcommand-help.md. Its phrasing captures the family precisely - help/behavior mismatch, not a missing feature - which is why the fix is rendering global flags on subcommand help rather than adding anything."
---

# UX: plan install --help omits --yes but --yes works

## Summary

plan install --help has agent/local/global only; plan install --yes --local works and installs skill without documenting --yes.

## Evidence

plan install help: no --yes
plan install --yes --local → Installed plan skill…

## Why it matters

Help/behavior mismatch for non-TTY.

## Suggested direction

Document --yes on help.

## Severity

Medium

## Area

Plan install
