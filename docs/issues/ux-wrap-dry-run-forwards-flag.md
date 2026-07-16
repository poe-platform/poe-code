---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "'npm run dev -- wrap goose --dry-run' prints 'Unknown command: wrap'; src/cli/ui/ui.test.ts:139-146 asserts no wrap command is registered, and rg finds no wrap command source under src/ or packages/."
comment: "Predates the wrap removal and is now moot: ux-readme-features-wrap-but-cli-missing.md and ux-wrap-command-still-missing.md both confirm 'poe-code wrap' returns Unknown command, so this transcript describes a command that no longer exists. Close as obsolete rather than merging. Its observation was good though and worth remembering if wrap ever returns: forwarding --dry-run into the agent's argv invents a flag the user never passed and misrepresents what would run."
---

# UX: wrap --dry-run invents agent --dry-run

## Summary

would run goose --dry-run.

## Evidence

wrap goose --dry-run.

## Why it matters

Misrepresents contract.

## Suggested direction

Real argv only.

## Severity

Medium

## Area

Dry-run
