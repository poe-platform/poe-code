# UX: provider login anthropic --dry-run is quiet and clear (positive)

## Summary

provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets — good dry-run (contrast provider logout).

## Evidence

```bash
$ poe-code provider login anthropic --api-key test-key --yes --dry-run
●  Dry run: would save credential for anthropic.
```

## Why it matters

Positive dry-run pattern for credentials.

## Suggested direction

Mirror for logout and configure.

## Severity

Low

## Area

Providers / positive pattern
