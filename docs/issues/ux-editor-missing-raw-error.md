---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/config.ts:234 throws bare Error; bootstrap.ts:71-81 routes non-CliError to system chrome. Probe with EDITOR/VISUAL unset (bypassing npm, which injects EDITOR=vi) printed 'Error: Set $EDITOR to use this command' plus 'See logs at ~/.poe-code/logs/errors.log for more details.'; memory.ts:148 uses ValidationError for the identical check and stays clean."
comment: "Fourth filing of the missing-EDITOR complaint, but the only one identifying the cause: config.ts throws a bare Error, which is why the chrome is wrong downstream. That makes it the keeper - retire the other three into it, since a typed MissingEditorError fixes the presentation automatically. It also illustrates the general mechanism behind ux-user-errors-look-like-system-failures.md: bare throws become system chrome."
---

# UX: Missing EDITOR raw Error

## Summary

throw new Error Set $EDITOR.

## Evidence

config.ts.

## Why it matters

Env prerequisite.

## Suggested direction

MissingEditorError.

## Severity

Low–Medium

## Area

Editor
