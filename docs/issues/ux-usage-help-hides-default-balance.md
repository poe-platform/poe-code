---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/usage.ts:169-181 - bare `usage` action calls executeBalance while the `balance` subcommand is registered with { hidden: true }, so `usage --help` lists only `list`; duplicate of ux-usage-help-hides-default-balance-reconfirmed.md"
comment: "Contentless twin of ux-usage-help-hides-default-balance-reconfirmed.md; retire into it."
---

# UX: usage help hides balance default

## Summary

Bare usage balance; help omits.

## Evidence

usage --help.

## Why it matters

Undocumented default.

## Suggested direction

Document balance.

## Severity

Low–Medium

## Area

Usage
