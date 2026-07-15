---
severity: high
impact: usability
comment: "Keep as the umbrella for the largest cluster in the audit: roughly thirty filings report the same shape - a correct message dressed in system chrome with a 'See logs' pointer to a log that adds nothing. Its diagnosis names the mechanism (recoverable conditions thrown as bare Error, so bootstrap treats them as crashes) and its fix is one classification change that closes the whole family - the strongest single leverage point here alongside the constants fix. ux-editor-missing-raw-error.md and ux-sdk-getpoeapikey-throws-generic-error.md identify the same bare-throw pattern in source; ux-runtime-missing-deps-good-message-system-chrome.md is the best exemplar of good content ruined by classification."
---

# UX: Expected user mistakes treated as system failures

## Summary

Recoverable errors thrown as Error; bootstrap See logs + errors.log.

## Evidence

configure not-an-agent; spawn no prompt.

## Why it matters

Users feel crash.

## Suggested direction

ValidationError/isUserError for expected mistakes.

## Severity

**High**

## Area

Errors / trust
