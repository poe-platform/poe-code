# UX: provider logout anthropic --dry-run is clean (positive)

## Summary

provider logout anthropic --dry-run only shows would log out + rm credentials.anthropic.enc — good contrast to provider logout poe multi-agent flood.

## Evidence

```bash
$ poe-code provider logout anthropic --dry-run
●  Dry run: would log out from anthropic.
●  rm …/credentials.anthropic.enc # delete
```

## Why it matters

Positive credential-only logout dry-run.

## Suggested direction

Make poe logout dry-run match this calm style.

## Severity

Low

## Area

Providers / positive pattern
