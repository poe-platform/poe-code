---
severity: low
impact: none
comment: "Positive pattern with the right caveat built in: not requiring --yes is correct for a no-op, and its own note that a clear which would actually delete entries should require --yes is precisely the gap ux-runtime-templates-clear-no-yes-or-dry-run.md reports. Read together they show the guard is missing only on the destructive path - keep this as the boundary case."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/runtime/templates/clear.ts:41-44 returns the no-op info message before any guard; the destructive path at clear.ts:47-58 already gates on flags.assumeYes with dsConfirm, so the caveat's suggested gap does not exist"
---

# UX: runtime templates clear empty is clear without --yes (positive)

## Summary

runtime templates clear with empty cache: No local runtime template cache entries to clear — clear; --yes not required for no-op.

## Evidence

●  No local runtime template cache entries to clear.

## Why it matters

Positive empty clear message.

## Suggested direction

Keep; if clear would delete entries, require --yes.

## Severity

Low

## Area

Runtime / positive pattern
