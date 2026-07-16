---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/config.ts:234 throws plain Error('Set $EDITOR to use this command'); src/cli/bootstrap.ts:71-79 routes non-CliError to 'Error: ...' plus 'See logs at .../errors.log', while memory.ts:148 uses ValidationError for the identical check"
comment: "Third filing of the missing-EDITOR complaint and contentless; retire into the consolidated issue. The underlying point is the systemic UserError chrome problem rather than anything specific to the editor."
---

# UX: Missing EDITOR system chrome

## Summary

Set $EDITOR + logs.

## Evidence

utils config edit.

## Why it matters

Easy ValidationError.

## Suggested direction

Examples.

## Severity

Medium

## Area

Editor
