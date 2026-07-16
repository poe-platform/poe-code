---
severity: medium
impact: usability
comment: "Duplicate of ux-utils-config-edit-missing-editor-system-chrome.md (same command, message and complaint); consolidate. Valid but small - the message is already correct, so this is one more instance of the systemic UserError-vs-system-chrome issue (ux-user-errors-look-like-system-failures.md). Only local value-add: suggest 'export EDITOR=vim' as the next step."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/config.ts:234 throws plain Error('Set $EDITOR to use this command'); src/cli/bootstrap.ts:66-77 renders non-CliError as 'Error: ...' plus 'See logs at ~/.poe-code/logs/errors.log'"
---

# UX: utils config edit missing $EDITOR has See logs

## Summary

utils config edit without EDITOR: Set $EDITOR to use this command + See logs — clear message, system chrome.

## Evidence

■  Error: Set $EDITOR to use this command
●  See logs …

## Why it matters

UserError without logs; suggest export EDITOR=vim.

## Suggested direction

UserError; next step example.

## Severity

Medium

## Area

Utils
