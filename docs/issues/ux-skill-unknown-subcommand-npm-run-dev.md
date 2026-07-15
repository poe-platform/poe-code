---
severity: medium
impact: discoverability
comment: "Per-command npm run dev filing; retire into ux-development-mode-usage-intentional-but-leaks.md. Its typo-suggestions ask belongs to the did-you-mean cluster."
---

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
