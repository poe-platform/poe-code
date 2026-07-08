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
