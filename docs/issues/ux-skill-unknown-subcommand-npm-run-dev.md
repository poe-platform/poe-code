# UX: skill unknown subcommand uses npm run dev recovery

## Summary

skill foobar: Unknown command: foobar + Run npm run dev -- skill --help — identity leak on skill group.

## Evidence

Unknown command: foobar
Run npm run dev -- skill --help for available commands.

## Why it matters

Reconfirm displayBinaryName on nested groups.

## Suggested direction

poe-code skill --help; typo suggestions.

## Severity

Medium

## Area

Help / identity
