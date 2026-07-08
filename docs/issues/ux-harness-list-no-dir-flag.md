# UX: harness list has no --dir (cannot list custom scaffold dir)

## Summary

harness new supports --dir; harness list --dir is unknown — cannot list pairs created outside default search paths.

## Evidence

```bash
$ poe-code harness list --dir /tmp/ux-h2
error: unknown option '--dir'
```

## Why it matters

Asymmetric new vs list for custom directories.

## Suggested direction

Add --dir to list/run discovery.

## Severity

Medium

## Area

Harness
