---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/usage.ts:177 registers balance with { hidden: true } while usage.action() at :170 runs executeBalance; `npm run dev -- usage --help` prints only 'Commands: list [options]' with no balance or default-action mention"
comment: "Keep of this pair (better evidence: it shows the default working and the help omitting it). Real and slightly ironic: the one group that gets the default-action question right is the one that never documents it, so users cannot discover the behavior the rest of the CLI should copy. Fix is small - list balance as a command or state the default."
---

# UX: usage --help hides default balance behavior (reconfirmed)

## Summary

usage with no subcommand runs balance successfully, but usage --help only lists list subcommand — default balance path undocumented.

## Evidence

```bash
$ poe-code usage
●  Balance: $…
$ poe-code usage --help
Commands: list
# no balance command listed
```

## Why it matters

Reconfirm help/default mismatch for primary usage path.

## Suggested direction

Document default balance; list balance command or Examples.

## Severity

Medium

## Area

Usage
