---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "`npm run dev -- unconfigure --help` and `install --help` both print 'Options: -h, --help' only; -y/--dry-run/--verbose are program-level options (src/cli/program.ts:852-854) and showGlobalOptions is never enabled, yet unconfigure honours flags.dryRun (src/cli/commands/unconfigure.ts:41)"
comment: "Third of the sparse-help trio, but it carries the one argument justifying a higher severity and that should survive the merge: unconfigure is destructive and its help documents nothing but -h, so users cannot learn a --dry-run exists before running it. Split the unconfigure half into the destructive-command work (ux-unconfigure-help-omits-yes-and-dry-run.md) and merge the install half into the install help issue."
---

# UX: install and unconfigure --help still sparse (reconfirmed)

## Summary

install and unconfigure help only agent and -h — no --yes/--force/--dry-run notes; unconfigure is destructive.

## Evidence

install Options: -h only
unconfigure Options: -h only

## Why it matters

Reconfirm sparse installer/unconfigure help.

## Suggested direction

Document --yes/--dry-run; unconfigure blast radius.

## Severity

**High**

## Area

Install / Unconfigure
