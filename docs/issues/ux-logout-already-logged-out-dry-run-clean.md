# UX: logout --dry-run when already logged out is clean (positive)

## Summary

logout --dry-run when not logged in: Already logged out; no filesystem changes — clean, no secrets.

## Evidence

●  Already logged out.
●  # no filesystem changes

## Why it matters

Positive logout no-op dry-run when logged out (contrast secret leak when logged in).

## Suggested direction

Keep; still redact when logged in dry-run shows diffs.

## Severity

Low

## Area

Auth / positive pattern
