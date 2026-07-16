---
severity: low-medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- utils symlink skills --dry-run --cwd /tmp/probe-symlink-x exits 1 with 'requires --local, --global, or --yes when running without an interactive TTY' (src/cli/commands/utils-symlink-skills.ts:70-77), while utils symlink agents --dry-run exits 0; agents has no scope option (src/cli/commands/utils-symlink-agents.ts:31-33), so the asymmetry is inherent and the error is actionable."
comment: "Too vague to action as filed ('skills dry-run needs flags') - it asserts an inconsistency between the agents and skills subcommands without showing either contract. Needs the two invocations pasted. If real it belongs with the flag-consistency family; as written there is nothing to verify."
---

# UX: symlink skills vs agents scope

## Summary

skills dry-run needs flags.

## Evidence

utils symlink.

## Why it matters

Inconsistent.

## Suggested direction

Align contract.

## Severity

Low–Medium

## Area

Utils
