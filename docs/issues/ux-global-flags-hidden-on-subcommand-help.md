---
severity: medium
impact: discoverability
comment: "The general statement of a real problem: --yes, --dry-run and --verbose are root-level flags that never appear on subcommand help, so help-first users cannot know the CI contract. Keep as the umbrella and retire the per-command instances into it. One fix - a Global Options section in the shared help formatter - closes the family, which makes it dependent on the help unification in ux-dual-help-systems.md."
---

# UX: Global flags hidden on subcommands

## Summary

--yes/--dry-run/--verbose missing on most help.

## Evidence

spawn --help.

## Why it matters

CI miss contract.

## Suggested direction

Global Options section.

## Severity

Medium

## Area

Help
