---
severity: medium
impact: security
comment: "The best filing of the --api-key argv class: it enumerates all four affected surfaces and correctly argues that auth login is the highest-exposure instance because it is the primary credential-storage path users will actually reach for. Promote this to the umbrella for the class and link ux-agent-api-key-flag-on-help.md, ux-provider-login-api-key-flag-history-risk.md and ux-api-key-flags-encourage-shell-history-leaks.md to it. Its Medium rating under-rates it relative to those siblings; align the class to one severity."
---

# UX: auth login --api-key exposes Poe API key via CLI flag

## Summary

`poe-code auth login --api-key <key>` accepts the Poe API key as a positional CLI flag. Any value passed this way is:

1. Recorded in shell history (`.bash_history`, `.zsh_history`)
2. Visible in `ps aux` output while the process is running
3. Captured by CI logs, audit logs, and terminal recordings

## Evidence

```
Options:
  --api-key <key>   Poe API key
  -h, --help        Display help for command
```

## Context

This is the fourth occurrence of the same class of issue across `poe-code`:
- `configure --api-key`
- `agent --api-key`
- `provider login --api-key`
- `auth login --api-key` (this one)

## Why it matters

`auth login` is the primary credential-storage command. Users storing a Poe API key will most commonly use this flag, making it the highest-exposure instance of this pattern.

## Suggested direction

Prompt for the key interactively (masked input) when `--api-key` is not passed. If a non-interactive path is needed, document using an environment variable (`POE_API_KEY`) or stdin pipe instead.

## Severity

Medium

## Area

Auth / login / security / shell history
