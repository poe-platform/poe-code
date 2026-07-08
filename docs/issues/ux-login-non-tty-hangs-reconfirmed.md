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
