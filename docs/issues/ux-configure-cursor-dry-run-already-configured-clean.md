# UX: configure cursor --yes --dry-run already configured is clean (positive)

## Summary

configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — clean intentional dry-run when no-op.

## Evidence

Dry run: would configure Cursor.
# no filesystem changes

## Why it matters

Positive dry-run no-op pattern.

## Suggested direction

Keep; apply to skip-if-configured.

## Severity

Low

## Area

Configure / positive pattern
