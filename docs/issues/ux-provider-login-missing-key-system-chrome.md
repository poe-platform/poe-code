---
severity: medium
impact: usability
comment: "Contentless instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Its 'isUserError' suggestion names the actual mechanism, which is more useful than the file's brevity implies - the fix is classifying the error, not rewording it."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:219 throws bare Error for missing API key; bootstrap.ts:71-80 adds 'Error:' prefix plus 'See logs' for non-isUserError; duplicate of ux-user-errors-look-like-system-failures.md"
---

# UX: provider login missing key system chrome

## Summary

Good message + logs.

## Evidence

provider login anthropic --yes.

## Why it matters

Auth class.

## Suggested direction

isUserError.

## Severity

Medium

## Area

Provider auth
