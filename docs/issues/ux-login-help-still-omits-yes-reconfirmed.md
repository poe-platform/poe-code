---
severity: low-medium
impact: discoverability
comment: "Reconfirm duplicate within the login help cluster with no new evidence; retire. Five filings of one sparse help panel, spanning Low-Medium and Medium, is count inflation."
---

# UX: login --help still omits --yes (reconfirmed)

## Summary

login help only --api-key and -h — --yes works for non-TTY but undocumented (reconfirm).

## Evidence

login Options: --api-key, -h only.

## Why it matters

Reconfirm login help gap for CI.

## Suggested direction

Document --yes and POE_API_KEY.

## Severity

Low–Medium

## Area

Auth / help
