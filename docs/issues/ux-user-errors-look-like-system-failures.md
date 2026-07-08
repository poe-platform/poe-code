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
