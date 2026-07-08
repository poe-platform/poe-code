# UX: runtime init --dry-run is clean (positive)

## Summary

runtime init --type host --yes --dry-run: would set runtime.type; would create Dockerfile if missing — intentional dry-run.

## Evidence

Dry run: would set runtime.type to "host".

## Why it matters

Positive dry-run pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Runtime / positive pattern
