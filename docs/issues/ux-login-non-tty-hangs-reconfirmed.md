---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/login.ts:51 calls resolveApiKey without any TTY guard; src/cli/options.ts:157-165 falls through to init.loginViaOAuth() when no --api-key/POE_API_KEY/--yes; src/cli/oauth-login.ts:57-63 awaits authorization.waitForResult() with no timeout and only aborts if stdin closed AND browser launch failed; requireInteractiveStdin exists at src/cli/commands/shared.ts:393 but login never calls it"
comment: "Reconfirm of ux-login-non-tty-hangs-on-oauth.md with a measured timeout (45s+); consolidate. The measured hang is the useful evidence - it distinguishes a slow path from a genuine wait-forever. Fix by detecting non-TTY and requiring --api-key or POE_API_KEY, reusing the message --yes already produces. Duplicate: track the fix on ux-login-non-tty-hangs-on-oauth.md."
---

# UX: login without args non-TTY hangs (reconfirmed)

## Summary

login without --api-key in non-TTY hung past 45s — reconfirm login-non-tty-hangs-on-oauth rather than fail-fast ValidationError.

## Evidence

```bash
$ poe-code login
# hangs (probe timed out 45s)
```

## Why it matters

Reconfirm non-TTY OAuth hang.

## Suggested direction

Fail fast: require --api-key or TTY; document.

## Severity

**High**

## Area

Auth / non-TTY
