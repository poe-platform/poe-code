---
severity: critical
impact: security
comment: "Duplicate reconfirm in the four-file auth api-key --dry-run cluster; contributes only a second live sighting and no new evidence. Retire into ux-auth-api-key-dry-run-still-prints-secret.md."
---

# UX: auth api-key --dry-run still prints full secret (live reconfirm)

## Summary

Reconfirmed live: auth api-key --dry-run prints full key line (redacted in audit logs only by us) — Critical still open.

## Evidence

auth api-key --dry-run → sk-poe-… on stdout.

## Why it matters

Reconfirm Critical secret reveal.

## Suggested direction

Mask by default; --reveal for full; never dry-run print.

## Severity

**Critical**

## Area

Auth / security
