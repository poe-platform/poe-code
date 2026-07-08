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
