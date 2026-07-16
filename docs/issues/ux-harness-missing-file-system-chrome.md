---
severity: medium
impact: usability
comment: "Contentless duplicate of ux-harness-run-missing-file-system-chrome.md; retire into it. Both are instances of the systemic UserError chrome issue where the message is already correct."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-harness/src/loader/pair.ts:27 MissingPairError extends plain Error; src/cli/commands/harness.ts:129 resolvePair unwrapped; src/cli/bootstrap.ts:71-79 non-CliError path prints 'Error:' plus 'See logs'"
---

# UX: harness missing file system chrome

## Summary

Good message + See logs.

## Evidence

harness run /missing.

## Why it matters

User path.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Harness
