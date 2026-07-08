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
