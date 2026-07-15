---
severity: medium
impact: discoverability
comment: "Duplicate within the sparse install help trio; retire. Its notable detail is that --yes works while undocumented, which is the same undocumented-global-flag problem as ux-global-flags-hidden-on-subcommand-help.md rather than an install-specific omission."
---

# UX: install --help has no --force or options beyond -h

## Summary

install help only agent arg and -h — no --force, --yes, dry-run notes; install opencode --yes works but undocumented on install help.

## Evidence

install Options: -h only.

## Why it matters

Installers need documented force/yes policy.

## Suggested direction

Document --yes/--force; align with other installers.

## Severity

Medium

## Area

Install
