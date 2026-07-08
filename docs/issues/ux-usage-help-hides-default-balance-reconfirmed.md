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
