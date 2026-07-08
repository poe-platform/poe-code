# UX: memory ingest missing file is ENOENT system chrome

## Summary

memory ingest /tmp/no-such-file: ENOENT open path + See logs — should be ValidationError source not found.

## Evidence

■  Error: ENOENT: no such file or directory, open '/tmp/no-such-file'
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

Source not found: path. Provide file or URL.

## Severity

Medium

## Area

Memory
