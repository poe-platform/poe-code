# UX: memory ingest without init points to memory init (positive)

## Summary

Memory is not initialized. Run poe-code memory init — clear recovery.

## Evidence

```bash
$ poe-code memory ingest /tmp/no.txt --yes
■  Memory is not initialized. Run "poe-code memory init" in this project.
```

## Why it matters

Positive not-initialized pattern across memory commands.

## Suggested direction

Keep.

## Severity

Low

## Area

Memory / positive pattern
