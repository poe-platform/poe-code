# UX: provider login anthropic --dry-run is clean (positive)

## Summary

provider login anthropic --api-key sk-fake --dry-run: would save credential; no filesystem changes — clean dry-run without printing key.

## Evidence

Dry run: would save credential for anthropic. # no filesystem changes

## Why it matters

Positive dry-run for credentials.

## Suggested direction

Keep.

## Severity

Low

## Area

Providers / positive pattern
