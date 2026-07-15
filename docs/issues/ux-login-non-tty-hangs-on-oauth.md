---
severity: high
impact: crash
comment: "One of two filings of the real login defect; consolidate with ux-login-non-tty-hangs-reconfirmed.md. Correctly High and correctly reasoned: a hang is worse than an error because CI has nothing to act on and the job burns its timeout. Notably ux-login-yes-without-key-message-good.md shows the fail-fast message already exists behind --yes, so this is propagating existing behavior to the bare non-TTY path rather than new work."
---

# UX: login without key hangs non-TTY on OAuth

## Summary

Bare login starts OAuth wait forever without TTY.

## Evidence

login non-TTY Waiting for authorization hang.

## Why it matters

Hang worse than clear error.

## Suggested direction

Fail-fast non-TTY without --api-key.

## Severity

**High**

## Area

Auth / CI
