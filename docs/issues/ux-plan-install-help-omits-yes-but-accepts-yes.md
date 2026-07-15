---
severity: medium
impact: discoverability
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
