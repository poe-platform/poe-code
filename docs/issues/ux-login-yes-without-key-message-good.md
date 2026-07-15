---
severity: low
impact: none
comment: "One of the most useful positives in the audit: the message offers three recovery paths (--api-key, POE_API_KEY, drop --yes for interactive) and is exactly what the bare non-TTY path should emit instead of hanging (ux-login-non-tty-hangs-on-oauth.md). It proves the fix there is reuse rather than new work. Keep and link from the hang issue; absorbs ux-login-yes-message-good-but-worth-aligning.md."
---

# UX: login --yes without key message is clear (positive)

## Summary

login --yes without key: No API key found. Pass --api-key, set POE_API_KEY, or run without --yes to authenticate interactively — clear multi-path recovery.

## Evidence

No API key found. Pass --api-key, set POE_API_KEY, or run without --yes…

## Why it matters

Positive non-TTY login guidance (contrast bare login hang).

## Suggested direction

Keep; still fix hang without --yes.

## Severity

Low

## Area

Auth / positive pattern
