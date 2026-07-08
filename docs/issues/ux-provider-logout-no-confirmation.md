# UX: provider logout runs immediately without confirmation or --yes flag

## Summary

`poe-code provider logout <id>` removes provider credentials without any prompt, confirmation, or `--yes` flag requirement. Running `poe-code provider logout anthropic` immediately logs out silently.

```
Options:
  -h, --help   Display help for command
```

Only `--help` is available — no `--dry-run`, no `--yes`, no confirmation prompt.

## Context

This is the third destructive command with no confirmation gate:
1. `auth logout` — removes ALL agent configurations immediately (Critical, already filed)
2. `memory clear` — deletes all memory without confirmation (High, already filed)
3. `provider logout` — removes provider credentials without confirmation (this issue)

## Why it matters

A user who misremembers the provider ID or tab-completes to the wrong provider loses their credentials with no undo. The action is silent.

## Suggested direction

Require `--yes` or show a "Log out from anthropic? (y/N)" prompt before executing. Show what will be removed (e.g. stored API key, session token).

## Severity

High

## Area

Provider / logout / safety / destructive / confirmation
