---
severity: high
impact: crash
comment: "Reconfirm of ux-login-non-tty-hangs-on-oauth.md with a measured timeout (45s+); consolidate. The measured hang is the useful evidence - it distinguishes a slow path from a genuine wait-forever. Fix by detecting non-TTY and requiring --api-key or POE_API_KEY, reusing the message --yes already produces."
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
