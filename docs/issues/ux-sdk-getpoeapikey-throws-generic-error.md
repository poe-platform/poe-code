---
severity: medium
impact: usability
comment: "Legitimate and precise: the message is fine and the type is not, so consumers cannot distinguish 'user has not logged in' from a bug without string-matching. Same bare-throw mechanism as ux-editor-missing-raw-error.md and the same root as the whole UserError-classification family - untyped errors cannot be presented or handled correctly downstream. Its fix (export typed errors with a code field) also serves the CLI, since classification is what ux-user-errors-look-like-system-failures.md needs."
---

# UX: SDK getPoeApiKey throws generic Error not typed user error

## Summary

SDK credential helper throws new Error("No API key found…") rather than a typed/user-facing error class, so consumers cannot reliably branch on auth-missing vs bugs.

## Evidence

src/sdk/credentials.ts throws Error for missing key.
Message text is OK; type is not.

## Why it matters

SDK/CLI parity and script error handling suffer.

## Suggested direction

Export AuthError/ValidationError from SDK with code field.

## Severity

Medium

## Area

SDK
