---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/options.ts:110-165 resolveApiKey falls through to init.loginViaOAuth() with no TTY check; src/cli/oauth-login.ts:62-64 awaits waitForResult() with no timeout (packages/poe-oauth/src/loopback-authorization.ts waitForCode has none either); shared.ts:393 requireInteractiveStdin exists and is used by launch.ts:467/tasks.ts:218 but login.ts never calls it; only guard is stdin-closed AND browser-launch-failed (oauth-login.ts:27-38)"
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
