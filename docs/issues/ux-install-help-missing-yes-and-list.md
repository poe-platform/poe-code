---
severity: medium
impact: discoverability
comment: "One of three filings about sparse install help; consolidate with ux-install-help-no-force-or-options.md and ux-install-unconfigure-help-still-sparse-reconfirmed.md. Its distinct ask is the useful one: there is no way to list installable agents, and since that list only exists in the argument description, the capability-matrix work (ux-agent-capability-matrix-spawn-vs-configure-vs-install.md) would give install --list its content for free."
---

# UX: install --help missing --yes and cannot list agents

## Summary

install --help only -h; no --yes documented though it works; --list unknown. Agent list only in argument description.

## Evidence

install help: agent arg choices; Options: -h only. --list unknown.

## Why it matters

Cannot discover installable agents via --list; --yes undocumented.

## Suggested direction

Document --yes; add install --list or show agents on missing arg.

## Severity

Medium

## Area

Install
